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
	hold    int // ticks a due reset has waited for traffic

	// Credit: what the seated driver has earned since taking the car over. Nothing
	// counts while the car is a bot (a pilot away, see lastPilot).
	credTick int  // tick of the takeover or reconnect; laps started at or after it are the driver's own
	credLaps int  // laps the driver completed
	skipLap  bool // the lap in progress at a reconnect: not the driver's
	ownBest  int  // ms: best valid lap the driver drove from the line, 0 = none
	ownFull  bool // completed a lap they drove from the line
	ownFlag  bool // took the flag seated

	// Reconnect: the pilot who left this car during a session, and when.
	lastPilot string
	lastTick  int
	lastSetup car.Setup
}

// Credit is what the pilot in a car has earned since taking it over, never
// while away: laps completed seated (after a reconnect, not the lap that was
// in progress), the best valid lap among the laps driven from the line, whether
// one such full lap was driven, and whether they took the flag themselves. A
// finish counts as a race only with Full and Flag.
type Credit struct {
	Laps   int
	BestMs int
	Full   bool
	Flag   bool
}

func (c *Car) credit() Credit {
	return Credit{Laps: c.credLaps, BestMs: c.ownBest, Full: c.ownFull, Flag: c.ownFlag}
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
	Finished  bool // crossed the line before the finish window closed; false = DNF
	Credit    Credit
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

// RaceStart is the tick of lights out (0 before the first start).
func (r *Race) RaceStart() int { return r.raceStart }

func (r *Race) Cars() []*Car { return r.cars[:] }

func (r *Race) makeBot(c *Car) {
	c.Driver = Driver{Name: fmt.Sprintf("Bot %d", c.ID), Setup: bot.Setup()}
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
	c.clearCredit()
	c.lastPilot = ""
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
// the last-placed bot while a race is running. A pilot who left a car within
// reconnectTicks during this session gets that car back as it is, credit and all.
func (r *Race) Seat(name, pilot string) (CarID, bool) {
	if c := r.left(pilot); c != nil {
		c.Driver = Driver{Human: true, Name: name, Pilot: pilot, Setup: c.lastSetup}
		c.P = car.NewParams(r.set.Handling, c.lastSetup, c.St.Dmg)
		c.lastPilot = ""
		c.credTick, c.skipLap = r.tick, r.underway() // credit resumes from now
		if r.creator == 0 {
			r.creator = c.ID
		}
		return c.ID, true
	}
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
		default: // the last-placed bot, a car kept for a reconnect only when there is no other
			if pick == nil || r.kept(pick) && !r.kept(c) || r.kept(pick) == r.kept(c) && c.Pos > pick.Pos {
				pick = c
			}
		}
	}
	if pick == nil {
		return 0, false
	}
	pick.clearCredit()
	pick.credTick, pick.lastPilot = r.tick, ""
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
	setup, p, pilot := c.Driver.Setup, c.P, c.Driver.Pilot
	r.makeBot(c)
	if keep {
		c.Driver.Setup, c.P = setup, p
	}
	if r.running() && pilot != "" {
		c.lastPilot, c.lastTick, c.lastSetup = pilot, r.tick, setup
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

// left is the bot car pilot left within reconnectTicks while a session runs, or nil.
func (r *Race) left(pilot string) *Car {
	if pilot == "" || !r.running() {
		return nil
	}
	for _, c := range r.cars {
		if r.kept(c) && c.lastPilot == pilot {
			return c
		}
	}
	return nil
}

// kept: c is a bot car held for the pilot who left it (see left).
func (r *Race) kept(c *Car) bool {
	return !c.Driver.Human && c.lastPilot != "" && r.tick-c.lastTick <= reconnectTicks
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
// aheadLat beside it (stored in nb), and into buf every standing car (below standSpeed) within standRange
// ahead, wherever it is across the track: the bot decides which are on its path, and a bot at
// speed sees a stopped car in time to go round it.
func (r *Race) ahead(i int, sp *[numCars]spot, nb *bot.Other, buf *[numCars]bot.Other) (near *bot.Other, stand []bot.Other) {
	nd := aheadRange
	stand = buf[:0]
	for j, o := range r.cars {
		if j == i {
			continue
		}
		d := math.Mod(sp[j].s-sp[i].s+r.tr.Length, r.tr.Length)
		if d <= 0 {
			continue
		}
		ob := bot.Other{St: &o.St, S: sp[j].s, Lat: sp[j].lat}
		if d <= nd && math.Abs(sp[j].lat-sp[i].lat) <= aheadLat {
			*nb, near, nd = ob, nb, d
		}
		if d <= standRange && o.St.Speed() < standSpeed {
			stand = append(stand, ob)
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
	var nb bot.Other
	var buf [numCars]bot.Other
	near, stand := r.ahead(i, sp, &nb, &buf)
	return c.brain.Drive(&c.St, &c.P, c.Seg, near, stand)
}

// Autopilot is the input car id's own bot brain would drive this tick: a seated human keeps
// the brain it had as a bot. Zero under the lights or for an unknown id. It advances the
// brain, so call it once per tick at most.
func (r *Race) Autopilot(id CarID) car.Input {
	if r.car(id) == nil {
		return car.Input{}
	}
	sp := r.spots()
	return r.botInput(int(id)-1, &sp)
}

// marshal puts every unfinished car that is not drivable and has been slower than resetSpeed
// for resetTicks racing ticks back on the racing line, pointing down the track and at rest
// (there is no reverse gear: a car nose-first against the wall cannot leave by itself). The
// drop spot is its own s or the nearest spot up to dropBack behind it with no car within
// dropFree (see dropSpot). Lap and timing state are kept; the time lost is the penalty. A due
// reset waits (retried every tick) while traffic would arrive on top of it (clearForReset), for
// holdMax ticks at most: then the car goes to the asphalt edge with fewer cars, traffic or not.
// Cars are reset in ID order, each against the positions of the ones reset before it.
func (r *Race) marshal() (reset []CarID) {
	for _, c := range r.cars {
		if c.Finished || c.St.Speed() >= resetSpeed || r.drivable(c) {
			c.slow, c.hold = 0, 0
			continue
		}
		if c.slow = min(c.slow+1, resetTicks); c.slow < resetTicks {
			continue
		}
		edge := c.hold >= holdMax
		_, _, s0 := r.tr.Locate(c.St.X, c.St.Z, c.Seg)
		i, lat, ok := r.dropSpot(c, s0, edge)
		if !ok || (!edge && !r.clearForReset(c, r.tr.Segs[i].S)) {
			r.held++
			c.hold++
			continue
		}
		g := r.tr.Segs[i]
		x, z := r.tr.Point(g.S, lat)
		c.St = car.State{X: x, Z: z, H: math.Atan2(g.TZ, g.TX), HX: g.TX, HZ: g.TZ, Gear: 1, Dmg: c.St.Dmg}
		c.Seg, _, c.S = r.tr.Locate(x, z, i)
		if c.S-s0 > r.tr.Length/2 { // back over the line: as when driven back over it
			c.rankLap--
		} else {
			r.advanceSector(c, s0)
		}
		c.brain.Reset()
		c.slow, c.hold = 0, 0
		reset = append(reset, c.ID)
	}
	return reset
}

// dropSpot is the seg and lat c is reset to: the racing line (edge: the asphalt edge on the
// side with fewer cars within resetBehind, the side away from the line on a tie) at s0 or
// dropStep, 2·dropStep … up to dropBack behind it, the first with no other car within dropFree.
func (r *Race) dropSpot(c *Car, s0 float64, edge bool) (i int, lat float64, ok bool) {
	n, L := len(r.tr.Segs), r.tr.Length
	for k := 0.0; k <= dropBack; k += dropStep {
		i = int(math.Round(math.Mod(s0-k+L, L)/L*float64(n))) % n
		g := &r.tr.Segs[i]
		lat = r.tr.Line[i]
		if edge {
			lat = r.edgeSide(c, g.S, lat) * (r.tr.Width/2 - edgeIn)
		}
		if x, z := r.tr.Point(g.S, lat); r.free(c, x, z) {
			return i, lat, true
		}
	}
	return 0, 0, false
}

// edgeSide is +1 (left) or −1: the side of the track with fewer other cars within resetBehind
// of s; on a tie the side away from the racing line (at lat line).
func (r *Race) edgeSide(c *Car, s, line float64) float64 {
	L := r.tr.Length
	var left, right int
	for _, o := range r.cars {
		if o == c {
			continue
		}
		_, lat, os := r.tr.Locate(o.St.X, o.St.Z, o.Seg)
		if math.Abs(math.Remainder(os-s, L)) > resetBehind {
			continue
		}
		if lat >= 0 {
			left++
		} else {
			right++
		}
	}
	switch {
	case left < right:
		return 1
	case right < left:
		return -1
	case line > 0:
		return -1
	}
	return 1
}

// free: no car but c has its centre within dropFree of (x, z).
func (r *Race) free(c *Car, x, z float64) bool {
	for _, o := range r.cars {
		if o != c && math.Hypot(o.St.X-x, o.St.Z-z) < dropFree {
			return false
		}
	}
	return true
}

// drivable: the car can drive away on its own (no reverse gear needed): on the asphalt and
// pointing within 45° of the track direction. The marshals leave such a car alone, however
// long it stands (an idle player is gone round, not moved).
func (r *Race) drivable(c *Car) bool {
	i, lat, _ := r.tr.Locate(c.St.X, c.St.Z, c.Seg)
	g := &r.tr.Segs[i]
	return math.Abs(lat) <= r.tr.Width/2 && c.St.HX*g.TX+c.St.HZ*g.TZ >= drivableCos
}

// clearForReset: no other unfinished car that is moving (resetSpeed or faster) is within
// resetBehind behind s along the track or within resetAhead ahead of it. Standing cars are
// not traffic (two stuck cars must not hold each other); dropSpot keeps the spot clear of them.
func (r *Race) clearForReset(c *Car, s float64) bool {
	L := r.tr.Length
	for _, o := range r.cars {
		if o == c || o.Finished || o.St.Speed() < resetSpeed {
			continue
		}
		if ahead := math.Mod(o.S-s+L, L); ahead <= resetAhead || L-ahead <= resetBehind {
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
				c.clearCredit()
			}
			r.setPhase(Racing)
			ev.PhaseChanged = true
		}
	case Racing:
		if r.finishing || elapsed >= r.set.Laps*lapCapTicks { // a race nobody completes ends too
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

// total is a finisher's race time with penalties, ms.
func (r *Race) total(c *Car) int { return (c.FinishTick-r.raceStart)*1000/tps + c.PenaltyMs }

// order is the results order: finishers by laps completed desc, then total time asc;
// the unfinished follow in road order.
func (r *Race) order() []*Car {
	total := r.total
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
	return cs
}

func (r *Race) results() []ResultRow {
	rows := make([]ResultRow, 0, numCars)
	for i, c := range r.order() {
		c.Pos = i + 1
		rows = append(rows, r.row(c, i+1))
	}
	return rows
}

// Standing is car id's row at its place in the results order now (false for an unknown id).
func (r *Race) Standing(id CarID) (ResultRow, bool) {
	for i, c := range r.order() {
		if c.ID == id {
			return r.row(c, i+1), true
		}
	}
	return ResultRow{}, false
}

func (c *Car) clearCredit() {
	c.credLaps, c.skipLap, c.ownBest, c.ownFull, c.ownFlag = 0, false, 0, false, false
}

func (r *Race) row(c *Car, pos int) ResultRow {
	t := 0
	if c.Finished {
		t = r.total(c)
	}
	return ResultRow{Pos: pos, Car: c.ID, Name: c.Driver.Name, Human: c.Driver.Human, Laps: c.Lap, TotalMs: t,
		BestMs: c.Best, PenaltyMs: c.PenaltyMs, Pilot: c.Driver.Pilot, Finished: c.Finished, Credit: c.credit()}
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
