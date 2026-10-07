package race

import (
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

func newRace(seed uint64) *Race {
	return New(Settings{Handling: car.Arcade, Contact: Ghost, Laps: 3, Seed: seed}, track.Kiyi())
}

// finishAllForTest forces the end of the race: the leader is done and every car finished.
func (r *Race) finishAllForTest() {
	r.finishing = true
	for _, c := range r.cars {
		c.Finished, c.FinishTick = true, r.tick
	}
}

func TestBotOnlyRoomCyclesPhases(t *testing.T) {
	r := newRace(1)
	if r.Phase() != Grid || len(r.Cars()) != 10 {
		t.Fatal("start state")
	}
	for r.Phase() != Racing && r.Tick() < 17*60+12 {
		r.Step(nil)
	}
	if r.Phase() != Racing {
		t.Fatalf("not racing after %d ticks", r.Tick())
	}
	r.finishAllForTest()
	seen := map[Phase]bool{}
	for i := 0; i < 20*60 && !seen[Grid]; i++ {
		r.Step(nil)
		seen[r.Phase()] = true
	}
	if !seen[Finish] || !seen[Results] || !seen[Grid] {
		t.Fatalf("phases seen %v", seen)
	}
}

func TestLightsTiming(t *testing.T) {
	run := func(seed uint64) (out int) {
		r := newRace(seed)
		for r.Phase() != Lights {
			r.Step(nil)
		}
		start, next := r.Tick(), 1
		for {
			ev := r.Step(nil)
			if ev.Lights != -1 {
				if ev.Lights != next || r.Tick()-start != next*60 {
					t.Fatalf("light %d at +%d", ev.Lights, r.Tick()-start)
				}
				next++
			}
			if ev.LightsOut {
				if next != 6 {
					t.Fatalf("lights out after %d lights", next-1)
				}
				d := r.Tick() - start
				if d < 312 || d > 372 {
					t.Fatalf("lights out at %d ticks", d)
				}
				return d
			}
		}
	}
	if run(7) != run(7) {
		t.Fatal("not deterministic")
	}
}

func TestJumpStartPenalty(t *testing.T) {
	r := newRace(3)
	a, _ := r.Seat("a", "")
	b, _ := r.Seat("b", "")
	r.Start(r.Creator())
	var jumps []CarID
	for r.Phase() == Lights && r.Tick() < 200 {
		var in map[CarID]car.Input
		if r.Tick() >= 100 {
			in = map[CarID]car.Input{a: {Throttle: 1}}
		}
		jumps = append(jumps, r.Step(in).JumpStart...)
	}
	if len(jumps) != 1 || jumps[0] != a {
		t.Fatalf("jump-start events %v, want [%d] once", jumps, a)
	}
	if r.Phase() != Lights {
		t.Fatal("lights ended early")
	}
	for _, c := range r.Cars() {
		want := 0
		if c.ID == a {
			want = 5000
		}
		if c.PenaltyMs != want {
			t.Fatalf("car %d penalty %d want %d", c.ID, c.PenaltyMs, want)
		}
	}
	_ = b
	for i := 0; i < 5; i++ {
		if ev := r.Step(map[CarID]car.Input{a: {Throttle: 1}}); len(ev.JumpStart) != 0 {
			t.Fatal("second event for the same start")
		}
	}
	if r.Cars()[0].PenaltyMs != 5000 {
		t.Fatal("penalty applied more than once")
	}
}

// Revving on the brake through the lights (the launch hold) keeps the car on
// its slot: no jump-start penalty, the engine at the launch rpm.
func TestLaunchHoldIsNoJumpStart(t *testing.T) {
	r := newRace(3)
	a, _ := r.Seat("a", "")
	r.Start(r.Creator())
	for r.Phase() == Lights && r.Tick() < 200 {
		r.Step(map[CarID]car.Input{a: {Throttle: 1, Brake: 1}})
	}
	c := r.car(a)
	if r.Phase() != Lights || c.PenaltyMs != 0 || c.St.RPM < 8800 || c.St.Speed() != 0 {
		t.Fatalf("phase %v penalty %d rpm %.0f speed %v", r.Phase(), c.PenaltyMs, c.St.RPM, c.St.Speed())
	}
}

func TestGridIgnoresInput(t *testing.T) {
	r := newRace(3)
	a, _ := r.Seat("a", "")
	x, z := r.Cars()[0].St.X, r.Cars()[0].St.Z
	for i := 0; i < 60 && r.Phase() == Grid; i++ {
		r.Step(map[CarID]car.Input{a: {Throttle: 1}})
	}
	if r.Cars()[0].St.X != x || r.Cars()[0].St.Z != z {
		t.Fatal("car moved on the grid")
	}
}

func TestStartSurfacesPhaseChange(t *testing.T) {
	r := newRace(1)
	r.Seat("a", "")
	r.Seat("b", "")
	r.Start(2) // not the creator
	if r.Phase() != Grid {
		t.Fatal("non-creator started")
	}
	if ev := r.Step(nil); ev.PhaseChanged {
		t.Fatal("spurious phase change")
	}
	r.Start(1)
	if r.Phase() != Lights {
		t.Fatal("creator could not start")
	}
	if ev := r.Step(nil); !ev.PhaseChanged || ev.Lights != -1 {
		t.Fatalf("event %+v", ev)
	}
	if ev := r.Step(nil); ev.PhaseChanged {
		t.Fatal("phase change repeated")
	}
}

func TestHumanGridTimer(t *testing.T) {
	r := newRace(1)
	r.Seat("a", "")
	for i := 0; i < 30*60-1; i++ {
		r.Step(nil)
	}
	if r.Phase() != Grid {
		t.Fatal("left the grid early")
	}
	r.Step(nil)
	if r.Phase() != Lights {
		t.Fatal("30 s timer did not start the lights")
	}
}

func TestCreatorHandover(t *testing.T) {
	r := newRace(1)
	a, _ := r.Seat("a", "")
	b, _ := r.Seat("b", "")
	r.Unseat(a)
	if r.Creator() != b {
		t.Fatalf("creator %d want %d", r.Creator(), b)
	}
	r.Unseat(b)
	if r.Creator() != 0 {
		t.Fatal("creator with no humans")
	}
}

func TestHoldVariesBySeed(t *testing.T) {
	seen := map[int]bool{}
	for seed := uint64(1); seed <= 8; seed++ {
		r := newRace(seed)
		for r.Phase() != Lights {
			r.Step(nil)
		}
		if r.holdTicks < 12 || r.holdTicks > 72 {
			t.Fatalf("seed %d hold %d", seed, r.holdTicks)
		}
		seen[r.holdTicks] = true
	}
	if len(seen) < 2 {
		t.Fatal("hold does not depend on seed")
	}
}

func TestResultsResetsGrid(t *testing.T) {
	r := newRace(1)
	a, _ := r.Seat("a", "pil")
	r.Ready(a, car.Setup{1, 2, 50, 2, 3, 4, 1})
	setup := r.Cars()[0].Driver.Setup
	for r.Phase() != Racing {
		r.Step(nil)
	}
	c := r.Cars()[0]
	c.St.Dmg = car.Damage{FrontWing: 0.5}
	c.PenaltyMs = 5000
	r.finishAllForTest()
	var rows []ResultRow
	for r.Phase() != Grid {
		if ev := r.Step(nil); ev.Results != nil {
			rows = ev.Results
		}
	}
	if len(rows) != 10 || rows[0].Pos != 1 {
		t.Fatalf("rows %v", rows)
	}
	if !c.Driver.Human || c.ID != a || c.Driver.Setup != setup || c.Driver.Ready {
		t.Fatalf("human not kept: %+v", c.Driver)
	}
	if c.PenaltyMs != 0 || c.St.Dmg != (car.Damage{}) || c.St.Speed() != 0 {
		t.Fatal("penalty/damage/speed not cleared")
	}
}

func TestMidRaceSeatKeepsSetup(t *testing.T) {
	r := newRace(1)
	a, _ := r.Seat("a", "")
	custom := car.Setup{1, 2, 50, 2, 3, 4, 1}
	r.Ready(a, custom)
	custom = r.Cars()[0].Driver.Setup
	for r.Phase() != Racing {
		r.Step(nil)
	}
	r.Unseat(a)
	id, ok := r.Seat("b", "")
	if !ok || id != 10 {
		// last-placed bot is car 10 unless a is it; either way look up by returned id
		t.Logf("seated %d", id)
	}
	// force the new human into the unseated car: seat until we get it
	for id != a {
		if id, ok = r.Seat("n", ""); !ok {
			t.Fatal("never got the car back")
		}
	}
	c := r.Cars()[a-1]
	if c.Driver.Setup != custom || c.P != car.NewParams(r.set.Handling, custom, c.St.Dmg) {
		t.Fatalf("setup %v", c.Driver.Setup)
	}
}

func TestLightsOutRebaselines(t *testing.T) {
	r := newRace(3)
	a, _ := r.Seat("a", "")
	r.Start(a)
	c := r.Cars()[0]
	for r.Phase() == Lights || r.Phase() == Grid {
		in := map[CarID]car.Input{}
		if c.St.Speed() < 5 && r.Tick() < 120 {
			in[a] = car.Input{Throttle: 1}
		} else {
			in[a] = car.Input{Brake: 1}
		}
		r.Step(in)
	}
	if c.PenaltyMs != 5000 {
		t.Fatalf("penalty %d", c.PenaltyMs)
	}
	_, _, s := r.tr.Locate(c.St.X, c.St.Z, -1)
	if c.S != s || c.Sector != 0 || !c.LapValid || c.OffTicks != 0 {
		t.Fatalf("not re-baselined: S %v want %v sector %d", c.S, s, c.Sector)
	}
	if i, _, _ := r.tr.Locate(c.St.X, c.St.Z, -1); c.Seg != i {
		t.Fatal("seg stale")
	}
}

func TestSeatAndUnseat(t *testing.T) {
	r := newRace(1)
	a, ok := r.Seat("a", "p")
	b, ok2 := r.Seat("b", "p")
	if !ok || !ok2 || a != 1 || b != 2 || r.Creator() != 1 {
		t.Fatalf("seat %d %d creator %d", a, b, r.Creator())
	}
	r.Unseat(b)
	if r.Cars()[1].Driver.Human {
		t.Fatal("still human")
	}
	if c, _ := r.Seat("c", ""); c != 2 {
		t.Fatalf("reseat got %d", c)
	}
	for i := 0; i < 8; i++ {
		r.Seat("x", "")
	}
	if _, ok := r.Seat("y", ""); ok {
		t.Fatal("seated in a full room")
	}
}

func TestMidRaceJoinerTakesLastPlaced(t *testing.T) {
	r := newRace(1)
	for r.Phase() != Racing {
		r.Step(nil)
	}
	if id, _ := r.Seat("late", ""); id != 10 {
		t.Fatalf("got %d, want last-placed car 10", id)
	}
}

func TestReadySetupClamped(t *testing.T) {
	r := newRace(1)
	id, _ := r.Seat("a", "")
	r.Ready(id, car.Setup{99, -5, 999, 99, 99, 99, 99})
	c := r.Cars()[0]
	if !c.Driver.Ready || c.Driver.Setup != c.Driver.Setup.Clamp() || c.Driver.Setup == (car.Setup{99, -5, 999, 99, 99, 99, 99}) {
		t.Fatalf("setup %v ready %v", c.Driver.Setup, c.Driver.Ready)
	}
	for r.Phase() != Lights && r.Tick() < 100 {
		r.Step(nil)
	}
	if r.Phase() != Lights {
		t.Fatal("all-ready humans should start the lights")
	}
	r.Ready(id, car.DefaultSetup())
	if r.Cars()[0].Driver.Setup == car.DefaultSetup() {
		t.Fatal("Ready accepted outside Grid")
	}
}

// A live change (the controls on the wheel) reaches the car on the Step that
// consumes it: TC 0 → 3 from a standing start cuts the drive on that very step.
func TestLiveChangeAppliesOnItsTick(t *testing.T) {
	start := func() (*Race, CarID) {
		r := New(Settings{Handling: car.Sim, Contact: Ghost, Laps: 3, Seed: 5}, track.Kiyi())
		a, _ := r.Seat("a", "p")
		s := car.DefaultSetup()
		s[car.TC] = 0
		r.Ready(a, s)
		for r.Phase() != Racing {
			r.Step(nil)
		}
		return r, a
	}
	r, a := start()
	ref, _ := start()
	c, rc := r.car(a), ref.car(a)
	if c.St != rc.St || c.P != rc.P {
		t.Fatal("the two races differ before the change")
	}
	p0 := c.P
	r.Live(a, c.Driver.Setup.LiveValues()) // the same values: nothing to rebuild
	if c.P != p0 {
		t.Fatal("unchanged live values rebuilt the params")
	}
	want := c.Driver.Setup
	want[car.TC] = 3
	r.Live(a, want.LiveValues())
	if c.Driver.Setup != want || c.P != car.NewParams(car.Sim, want, c.St.Dmg) || c.P.TCShare == p0.TCShare {
		t.Fatalf("setup %v, TC share %v (was %v)", c.Driver.Setup, c.P.TCShare, p0.TCShare)
	}
	in := map[CarID]car.Input{a: {Throttle: 1}}
	r.Step(in)
	ref.Step(in)
	if !(c.St.VX < rc.St.VX) {
		t.Fatalf("TC 3 should cut the drive on the next step: vx %v vs %v with TC off", c.St.VX, rc.St.VX)
	}
}

func TestLiveIgnoresBotsAndClamps(t *testing.T) {
	r := newRace(1)
	a, _ := r.Seat("a", "")
	bot := r.car(2)
	s, p := bot.Driver.Setup, bot.P
	r.Live(2, [4]int{70, 10, 0, 0})
	r.Live(99, [4]int{70, 10, 0, 0})
	if bot.Driver.Setup != s || bot.P != p {
		t.Fatal("a bot took live values")
	}
	r.Live(a, [4]int{999, -3, 7, -1})
	if got := r.car(a).Driver.Setup.LiveValues(); got != [4]int{70, 1, 3, 0} {
		t.Fatalf("not clamped: %v", got)
	}
}

// A reconnect gets the car back with the setup as last changed while racing.
func TestLiveChangeSurvivesReconnect(t *testing.T) {
	r := newRace(2)
	a, _ := r.Seat("a", "p")
	for r.Phase() != Racing {
		r.Step(nil)
	}
	r.Live(a, [4]int{52, 9, 2, 3})
	want := r.car(a).Driver.Setup
	r.Unseat(a)
	r.Step(nil)
	if id, ok := r.Seat("a", "p"); !ok || id != a {
		t.Fatalf("reseated in %d", id)
	}
	c := r.car(a)
	if c.Driver.Setup != want || c.Driver.Setup.LiveValues() != [4]int{52, 9, 2, 3} || c.P != car.NewParams(car.Arcade, want, c.St.Dmg) {
		t.Fatalf("setup %v want %v", c.Driver.Setup, want)
	}
}
