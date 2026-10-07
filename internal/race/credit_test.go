package race

import (
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
)

// autopilot drives every human car with its own bot brain this tick.
func autopilot(r *Race) map[CarID]car.Input {
	in := map[CarID]car.Input{}
	for _, c := range r.cars {
		if c.Driver.Human {
			in[c.ID] = r.Autopilot(c.ID)
		}
	}
	return in
}

func rowOf(rows []ResultRow, id CarID) (ResultRow, bool) {
	for _, w := range rows {
		if w.Car == id {
			return w, true
		}
	}
	return ResultRow{}, false
}

// A pilot who takes a bot over mid-race is credited with the laps completed
// since then and the best of the laps started since then only.
func TestTakeoverCreditsOwnLapsOnly(t *testing.T) {
	r := newRace(5)
	lapsAt := func() int {
		n := 1 << 30
		for _, c := range r.cars {
			n = min(n, c.Lap)
		}
		return n
	}
	for (r.Phase() != Racing || lapsAt() < 1) && r.Tick() < 600*60 {
		r.Step(nil)
	}
	id, ok := r.Seat("late", "p")
	if !ok {
		t.Fatal("no seat")
	}
	c := r.cars[id-1]
	from := c.Lap
	// The lap in progress counts when it started on the takeover tick (the
	// pilot drove all of it); otherwise the first own lap is the next one.
	firstOwn := from + 2
	if c.LapStart >= r.Tick() {
		firstOwn = from + 1
	}
	if from < 1 || c.Best == 0 {
		t.Fatalf("taken over at lap %d best %d: want a bot lap done", from, c.Best)
	}
	own := 0
	var row ResultRow
	for r.Tick() < 900*60 {
		ev := r.Step(autopilot(r))
		for _, l := range ev.Laps {
			if l.Car == id && l.Lap >= firstOwn && l.Valid && (own == 0 || l.Ms < own) {
				own = l.Ms
			}
		}
		if ev.Results != nil {
			row, _ = rowOf(ev.Results, id)
			break
		}
	}
	if !row.Finished || row.Credit.Laps != c.Lap-from || row.Credit.Laps < 1 || !row.Credit.Full || row.Credit.BestMs != own {
		t.Fatalf("row %+v: from lap %d, own best %d", row, from, own)
	}
}

// A pilot who sits in a car during Finish and never drives has earned nothing.
func TestFinishJoinerEarnsNothing(t *testing.T) {
	r := newRace(5)
	for r.Phase() != Finish && r.Tick() < 600*60 {
		r.Step(nil)
	}
	id, ok := r.Seat("late", "p")
	if !ok {
		t.Fatal("no seat")
	}
	for r.Tick() < 900*60 {
		if ev := r.Step(nil); ev.Results != nil {
			row, _ := rowOf(ev.Results, id)
			if row.Credit != (Credit{}) {
				t.Fatalf("credit %+v", row.Credit)
			}
			return
		}
	}
	t.Fatal("no results")
}

// Standing is a car's row at its place in the results order now.
func TestStandingAtPlaceNow(t *testing.T) {
	r := newRace(5)
	for r.Phase() != Finish && r.Tick() < 900*60 {
		r.Step(nil)
	}
	var lead *Car
	for _, c := range r.cars {
		if c.Finished {
			lead = c
		}
	}
	if lead == nil {
		t.Fatal("nobody finished")
	}
	if w, ok := r.Standing(lead.ID); !ok || w.Pos != 1 || !w.Finished || w.Laps != 3 || w.Car != lead.ID {
		t.Fatalf("%+v", w)
	}
	if _, ok := r.Standing(0); ok {
		t.Fatal("car 0")
	}
}

// Nothing counts while a pilot is away: not the lap the bot completes for them,
// not the lap in progress when they return (started while away); credit
// resumes with the next lap.
func TestNoCreditWhileAway(t *testing.T) {
	r := New(Settings{Handling: car.Arcade, Contact: Ghost, Laps: 5, Seed: 1}, newRace(1).tr)
	a, _ := r.Seat("a", "pa")
	r.Start(a)
	c := r.cars[a-1]
	own := map[int]LapEvent{}
	step := func(in map[CarID]car.Input) {
		for _, l := range r.Step(in).Laps {
			if l.Car == a {
				own[l.Lap] = l
			}
		}
	}
	for (c.Lap < 1 || r.Tick()-c.LapStart < 40*60) && r.Tick() < 600*60 {
		step(autopilot(r))
	}
	laps, best := c.credLaps, c.ownBest
	if laps != 1 || best == 0 || best != own[1].Ms {
		t.Fatalf("before leaving: %d laps best %d (lap 1 %+v)", laps, best, own[1])
	}
	r.Unseat(a)
	left := r.Tick()
	for c.Lap < 2 && r.Tick() < 600*60 {
		step(nil) // the bot completes lap 2
	}
	if r.Tick()-left > reconnectTicks {
		t.Fatalf("lap 2 took %d ticks away", r.Tick()-left)
	}
	if got, _ := r.Seat("a", "pa"); got != a {
		t.Fatalf("reconnect got %d", got)
	}
	for c.Lap < 4 && r.Tick() < 900*60 {
		step(autopilot(r))
	}
	want := best
	if l := own[4]; l.Valid && l.Ms < want {
		want = l.Ms
	}
	if c.credLaps != 2 || c.ownBest != want {
		t.Fatalf("credited %d laps (want 1 + lap 4), best %d want %d; laps %+v", c.credLaps, c.ownBest, want, own)
	}
}

// A pilot who drops mid-race and comes back within a minute gets the same car,
// place and lap back, credit resuming from the return; another joiner meanwhile
// does not take it.
func TestReconnectGetsOwnCar(t *testing.T) {
	r := newRace(1)
	a, _ := r.Seat("a", "pa")
	r.Start(a)
	c := r.cars[a-1]
	for (r.Phase() != Racing || r.Tick()-r.RaceStart() < 30*60) && r.Tick() < 600*60 {
		r.Step(autopilot(r))
	}
	if c.Pos != 1 {
		t.Fatalf("car %d is P%d, not leading", a, c.Pos)
	}
	r.Unseat(a)
	for range 2 * 60 {
		r.Step(nil)
	}
	lap := c.Lap
	if b, _ := r.Seat("b", "pb"); b == a {
		t.Fatal("a joiner took the car kept for its pilot")
	}
	got, ok := r.Seat("a2", "pa")
	if !ok || got != a || c.Pos != 1 || c.Lap != lap || !c.Driver.Human || c.Driver.Name != "a2" || c.credTick != r.Tick() || !c.skipLap {
		t.Fatalf("got car %d P%d lap %d (was %d) human %v", got, c.Pos, c.Lap, lap, c.Driver.Human)
	}
}

// After the window the car is gone: the normal rule (last-placed bot) applies.
func TestReconnectWindowCloses(t *testing.T) {
	r := newRace(1)
	a, _ := r.Seat("a", "pa")
	r.Start(a)
	for (r.Phase() != Racing || r.Tick()-r.RaceStart() < 10*60) && r.Tick() < 600*60 {
		r.Step(autopilot(r))
	}
	r.Unseat(a)
	for range reconnectTicks + 1 {
		r.Step(nil)
	}
	want := r.cars[0]
	for _, c := range r.cars {
		if c.Pos > want.Pos {
			want = c
		}
	}
	if got, _ := r.Seat("a", "pa"); got != want.ID {
		t.Fatalf("got %d want last-placed %d", got, want.ID)
	}
}

// Racing lasts Laps × lapCapTicks at most: then Finish, and its window ends the race.
func TestRacingTimeCap(t *testing.T) {
	r := New(Settings{Handling: car.Arcade, Contact: Ghost, Laps: 1, Seed: 1}, newRace(1).tr)
	for range numCars {
		r.Seat("idle", "")
	}
	r.Start(1)
	for r.Phase() != Racing {
		r.Step(nil)
	}
	start := r.Tick()
	for r.Phase() == Racing && r.Tick()-start <= lapCapTicks+1 {
		r.Step(nil)
	}
	if r.Phase() != Finish || r.Tick()-start != lapCapTicks {
		t.Fatalf("phase %v after %d ticks", r.Phase(), r.Tick()-start)
	}
	for r.Phase() == Finish {
		if ev := r.Step(nil); ev.Results != nil {
			for _, w := range ev.Results {
				if w.Finished {
					t.Fatalf("%+v", w)
				}
			}
		}
	}
	if r.Phase() != Results {
		t.Fatalf("phase %v", r.Phase())
	}
}
