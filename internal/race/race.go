package race

import (
	"fmt"
	"math"
	"sort"

	"github.com/ahmetbir/pitlane/internal/bot"
	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

type Settings struct {
	Handling car.Handling
	Contact  Contact
	Laps     int
	Listed   bool
	Seed     uint64
}

type CarID uint8 // 1..10

type Driver struct {
	Human bool
	Name  string
	Pilot string
	Setup car.Setup
	Ready bool
}

type Car struct {
	ID         CarID
	Driver     Driver
	St         car.State
	P          car.Params
	Seg        int
	Lap        int
	S          float64
	Sector     int
	LapStart   int // tick
	Best       int // ms, 0 = none
	Last       int // ms, 0 = none
	OffTicks   int
	LapValid   bool
	Finished   bool
	FinishTick int
	PenaltyMs  int
	Pos        int

	jumped  bool
	rankLap int // net forward line crossings, counted or not; ranking only
	slot    track.Pose
	brain   bot.Brain
	slow    int // consecutive racing ticks below resetSpeed (marshal reset)
}

type LapEvent struct {
	Car   CarID
	Lap   int
	Ms    int
	Valid bool
	Best  int
}

type ResultRow struct {
	Pos       int
	Car       CarID
	Name      string
	Human     bool
	Laps      int
	TotalMs   int
	BestMs    int
	PenaltyMs int
	Pilot     string
}

type Events struct {
	Lights       int // -1 none, else lights on
	LightsOut    bool
	Laps         []LapEvent
	Results      []ResultRow
	PhaseChanged bool
	WingLost     []CarID // cars whose front wing came off this tick (full contact)
	Reset        []CarID // cars the marshals put back on the racing line this tick
}

type Race struct {
	set   Settings
	tr    *track.Track
	prof  *bot.Profile // the bots' speed profile for this track and handling
	rng   rng
	cars  [numCars]*Car
	phase Phase
	tick  int

	phaseStart int // tick the phase began
	gridStart  int // tick the grid countdown began
	holdTicks  int // lights-out hold
	creator    CarID
	raceStart  int  // tick of lights out
	startEvent bool // Start changed the phase; surface it on the next Step
	held       int  // marshal resets put off for traffic (diagnostic)
	finishing  bool // leader has completed the race (set by timing)
}

// New builds a race with ten bot cars on the grid, in phase Grid.
func New(s Settings, tr *track.Track) *Race {
	r := &Race{set: s, tr: tr, rng: rng{s: s.Seed}, prof: bot.NewProfile(tr, s.Handling)}
	for i := range r.cars {
		id := CarID(i + 1)
		r.cars[i] = &Car{ID: id, Pos: i + 1}
		r.makeBot(r.cars[i])
		r.place(r.cars[i], tr.Grid[i])
	}
	return r
}

func (r *Race) Settings() Settings { return r.set }
func (r *Race) Phase() Phase       { return r.phase }
func (r *Race) Tick() int          { return r.tick }
func (r *Race) Creator() CarID     { return r.creator }

func (r *Race) Cars() []*Car { return r.cars[:] }

func (r *Race) makeBot(c *Car) {
	c.Driver = Driver{Name: fmt.Sprintf("Bot %d", c.ID), Setup: car.DefaultSetup()}
	c.P = car.NewParams(r.set.Handling, c.Driver.Setup, car.Damage{})
	seed := rng{s: r.set.Seed ^ uint64(c.ID)}
	c.brain = bot.NewBrain(seed.next(), r.prof)
}

func (r *Race) place(c *Car, p track.Pose) {
	c.slot = p
	c.St = car.State{X: p.X, Z: p.Z, H: p.H, HX: math.Cos(p.H), HZ: math.Sin(p.H), Gear: 1}
	c.Seg, _, c.S = r.tr.Locate(p.X, p.Z, 0)
	c.Lap, c.Sector, c.LapStart = 0, 0, r.tick
	c.Best, c.Last, c.OffTicks = 0, 0, 0
	c.LapValid, c.Finished, c.FinishTick, c.jumped, c.rankLap, c.slow = true, false, 0, false, 0, 0
}

func (r *Race) humans() (n int, allReady bool) {
	allReady = true
	for _, c := range r.cars {
		if c.Driver.Human {
			n++
			allReady = allReady && c.Driver.Ready
		}
	}
	return n, allReady
}

// Seat turns a bot car into a human one: the first bot on the grid and in results,
// the last-placed bot while a race is running.
func (r *Race) Seat(name, pilot string) (CarID, bool) {
	var pick *Car
	for _, c := range r.cars {
		if c.Driver.Human {
			continue
		}
		switch r.phase {
		case Grid, Results:
			if pick == nil {
				pick = c
			}
		default:
			if pick == nil || c.Pos > pick.Pos {
				pick = c
			}
		}
	}
	if pick == nil {
		return 0, false
	}
	if n, _ := r.humans(); n == 0 && r.phase == Grid {
		r.gridStart = r.tick
	}
	setup := car.DefaultSetup()
	if r.running() {
		setup = pick.Driver.Setup // the car keeps the params it is driving with
	}
	pick.Driver = Driver{Human: true, Name: name, Pilot: pilot, Setup: setup}
	if !r.running() {
		pick.P = car.NewParams(r.set.Handling, setup, pick.St.Dmg)
	}
	if r.creator == 0 {
		r.creator = pick.ID
	}
	return pick.ID, true
}

// Unseat hands the car back to the bots.
func (r *Race) Unseat(id CarID) {
	c := r.car(id)
	if c == nil || !c.Driver.Human {
		return
	}
	keep := r.underway()
	setup, p := c.Driver.Setup, c.P
	r.makeBot(c)
	if keep {
		c.Driver.Setup, c.P = setup, p
	}
	if r.creator == id {
		r.creator = 0
		for _, o := range r.cars {
			if o.Driver.Human {
				r.creator = o.ID
				break
			}
		}
	}
	if n, _ := r.humans(); n == 0 && r.phase == Grid {
		r.gridStart = r.tick
	}
}

// Ready stores the clamped setup and marks the driver ready (Grid only).
func (r *Race) Ready(id CarID, s car.Setup) {
	c := r.car(id)
	if r.phase != Grid || c == nil || !c.Driver.Human {
		return
	}
	c.Driver.Setup = s.Clamp()
	c.Driver.Ready = true
	c.P = car.NewParams(r.set.Handling, c.Driver.Setup, c.St.Dmg)
}

// Start lets the creator leave the grid early.
func (r *Race) Start(id CarID) {
	if r.phase == Grid && id != 0 && id == r.creator {
		r.setPhase(Lights)
		r.startEvent = true
	}
}

// running: a session is in progress (cars may be moving), so a seated car is taken as it is.
func (r *Race) running() bool { return r.phase == Lights || r.phase == Racing || r.phase == Finish }

// underway: the race itself has started; an unseated car keeps its setup.
func (r *Race) underway() bool { return r.phase == Racing || r.phase == Finish }

func (r *Race) car(id CarID) *Car {
	if id < 1 || int(id) > numCars {
		return nil
	}
	return r.cars[id-1]
}

const (
	aheadRange = 12.0  // m along the track
	aheadLat   = 4.0   // m either side
	standRange = 300.0 // m: how far ahead a standing car is seen
	standSpeed = 2.0   // m/s: below this a car is standing (the bots pass it anywhere)
)

// spot is where a car is on the track at the start of a tick.
type spot struct{ s, lat float64 }

// spots locates every car once, before any of them moves this tick.
func (r *Race) spots() (sp [numCars]spot) {
	for i, c := range r.cars {
		_, sp[i].lat, sp[i].s = r.tr.Locate(c.St.X, c.St.Z, c.Seg)
	}
	return sp
}

// ahead returns, for car i, the nearest car within aheadRange ahead along the track and
// aheadLat beside it, and the nearest standing car (below standSpeed) within standRange and
// aheadLat, so a bot at speed sees a stopped car in time to go round it.
func (r *Race) ahead(i int, sp *[numCars]spot) (near, stand *car.State) {
	nd, sd := aheadRange, standRange
	for j, o := range r.cars {
		if j == i || math.Abs(sp[j].lat-sp[i].lat) > aheadLat {
			continue
		}
		d := math.Mod(sp[j].s-sp[i].s+r.tr.Length, r.tr.Length)
		if d <= 0 {
			continue
		}
		if d <= nd {
			near, nd = &o.St, d
		}
		if d <= sd && o.St.Speed() < standSpeed {
			stand, sd = &o.St, d
		}
	}
	return near, stand
}

// botInput drives a bot car: still on the grid and under the lights, its brain once racing.
func (r *Race) botInput(i int, sp *[numCars]spot) car.Input {
	if r.phase == Lights {
		return car.Input{}
	}
	c := r.cars[i]
	near, stand := r.ahead(i, sp)
	return c.brain.Drive(&c.St, &c.P, c.Seg, near, stand)
}

// marshal puts every unfinished car that has been slower than resetSpeed for resetTicks
// racing ticks back on the racing line at its own s, pointing down the track and at rest
// (there is no reverse gear: a car nose-first against the wall cannot leave by itself).
// Lap, sector and timing state are kept; the time lost is the penalty. A due reset waits
// (and is retried every tick) while traffic would arrive on top of it: see clearForReset.
func (r *Race) marshal() (reset []CarID) {
	for _, c := range r.cars {
		if c.Finished || c.St.Speed() >= resetSpeed {
			c.slow = 0
			continue
		}
		if c.slow = min(c.slow+1, resetTicks); c.slow < resetTicks {
			continue
		}
		if !r.clearForReset(c) {
			r.held++
			continue
		}
		i, _, s := r.tr.Locate(c.St.X, c.St.Z, c.Seg)
		x, z := r.tr.Point(s, r.tr.Line[i])
		g := r.tr.Segs[i]
		c.St = car.State{X: x, Z: z, H: math.Atan2(g.TZ, g.TX), HX: g.TX, HZ: g.TZ, Gear: 1, Dmg: c.St.Dmg}
		c.Seg, _, c.S = r.tr.Locate(x, z, i)
		c.brain.Reset()
		c.slow = 0
		reset = append(reset, c.ID)
	}
	return reset
}

// clearForReset: no other unfinished car that is moving (resetSpeed or faster) is within
// resetBehind behind c along the track or within resetAhead ahead of it. Standing cars are
// not traffic: two stuck cars must not hold each other.
func (r *Race) clearForReset(c *Car) bool {
	L := r.tr.Length
	for _, o := range r.cars {
		if o == c || o.Finished || o.St.Speed() < resetSpeed {
			continue
		}
		if ahead := math.Mod(o.S-c.S+L, L); ahead <= resetAhead || L-ahead <= resetBehind {
			return false
		}
	}
	return true
}

// Step advances one tick. Cars are visited in ID order; inputs are looked up, never iterated.
func (r *Race) Step(inputs map[CarID]car.Input) Events {
	ev := Events{Lights: -1}
	r.tick++
	elapsed := r.tick - r.phaseStart
	ev.PhaseChanged = r.startEvent
	r.startEvent = false

	if r.running() {
		// Every input is decided before any car moves.
		var walls [numCars]wallHit
		sp := r.spots()
		var ins [numCars]car.Input
		for i, c := range r.cars {
			if c.Driver.Human {
				ins[i] = inputs[c.ID].Clean()
			} else {
				ins[i] = r.botInput(i, &sp)
			}
		}
		for i, c := range r.cars {
			in := ins[i]
			walls[i].j, walls[i].n = moveCar(&c.St, &c.P, in, r.tr, &c.Seg)
		}
		if r.phase != Lights {
			ev.WingLost = r.resolveContacts(&walls)
			r.timing(&ev)
			ev.Reset = r.marshal()
		}
	}

	switch r.phase {
	case Grid:
		n, ready := r.humans()
		if (n == 0 && r.tick-r.gridStart >= botGridTicks) ||
			(n > 0 && (ready || r.tick-r.gridStart >= humanGridTicks)) {
			r.setPhase(Lights)
			ev.PhaseChanged = true
		}
	case Lights:
		r.checkJumpStart()
		if elapsed%lightTicks == 0 && elapsed/lightTicks <= lightCount {
			ev.Lights = elapsed / lightTicks
		}
		if elapsed >= lightCount*lightTicks+r.holdTicks {
			ev.LightsOut = true
			r.raceStart = r.tick
			for _, c := range r.cars {
				c.LapStart, c.Lap = r.tick, 0
				c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
				c.Sector, c.LapValid, c.OffTicks, c.rankLap, c.slow = 0, true, 0, 0, 0
			}
			r.setPhase(Racing)
			ev.PhaseChanged = true
		}
	case Racing:
		if r.finishing {
			r.setPhase(Finish)
			ev.PhaseChanged = true
		}
	case Finish:
		all := true
		for _, c := range r.cars {
			all = all && c.Finished
		}
		if all || elapsed >= finishMaxTicks {
			ev.Results = r.results()
			r.setPhase(Results)
			ev.PhaseChanged = true
		}
	case Results:
		if elapsed >= resultsTicks {
			r.resetGrid()
			r.setPhase(Grid)
			ev.PhaseChanged = true
		}
	}
	return ev
}

func (r *Race) setPhase(p Phase) {
	r.phase = p
	r.phaseStart = r.tick
	switch p {
	case Grid:
		r.gridStart = r.tick
		r.finishing = false
	case Lights:
		r.holdTicks = int((0.2+r.rng.float())*tps + 0.5)
		for _, c := range r.cars {
			c.jumped = false
		}
	}
}

// checkJumpStart penalises cars that moved off their slot while the lights are on.
func (r *Race) checkJumpStart() {
	for _, c := range r.cars {
		g := c.slot
		if !c.jumped && math.Hypot(c.St.X-g.X, c.St.Z-g.Z) > jumpStartMeters {
			c.jumped = true
			c.PenaltyMs += jumpStartPenMs
		}
	}
}

// byPos returns the cars in race order (Pos, then ID).
func (r *Race) byPos() []*Car {
	cs := append([]*Car(nil), r.cars[:]...)
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].Pos < cs[j].Pos })
	return cs
}

func (r *Race) results() []ResultRow {
	// Finishers: laps completed desc, then total time with penalties asc. The unfinished follow in road order.
	total := func(c *Car) int { return (c.FinishTick-r.raceStart)*1000/tps + c.PenaltyMs }
	cs := r.byPos()
	sort.SliceStable(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if a.Finished != b.Finished {
			return a.Finished
		}
		if !a.Finished {
			return false
		}
		if a.Lap != b.Lap {
			return a.Lap > b.Lap
		}
		return total(a) < total(b)
	})
	rows := make([]ResultRow, 0, numCars)
	for i, c := range cs {
		t := 0
		if c.Finished {
			t = total(c)
		}
		c.Pos = i + 1
		rows = append(rows, ResultRow{Pos: i + 1, Car: c.ID, Name: c.Driver.Name, Human: c.Driver.Human,
			Laps: c.Lap, TotalMs: t, BestMs: c.Best, PenaltyMs: c.PenaltyMs, Pilot: c.Driver.Pilot})
	}
	return rows
}

// resetGrid lines the cars up in finishing order; humans keep their car and setup.
func (r *Race) resetGrid() {
	for i, c := range r.byPos() {
		c.St = car.State{}
		c.Pos = i + 1
		c.PenaltyMs = 0
		c.Driver.Ready = false
		if c.Driver.Human {
			c.P = car.NewParams(r.set.Handling, c.Driver.Setup, car.Damage{})
		} else {
			r.makeBot(c)
		}
		r.place(c, r.tr.Grid[i])
	}
}
