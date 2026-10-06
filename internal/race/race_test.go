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
	for r.Phase() != Racing && r.Tick() < 18*60 {
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
	if !seen[Finish] && !seen[Results] || !seen[Results] || !seen[Grid] {
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
	for r.Phase() != Lights {
		r.Step(nil)
	}
	r.Cars()[2].St.X += 1
	r.Cars()[4].St.X += 0.3
	r.Step(nil)
	r.Step(nil)
	for i, c := range r.Cars() {
		want := 0
		if i == 2 {
			want = 5000
		}
		if c.PenaltyMs != want {
			t.Fatalf("car %d penalty %d want %d", c.ID, c.PenaltyMs, want)
		}
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
	r.Ready(id, car.Setup{99, -5, 999, 99, 99, 99})
	c := r.Cars()[0]
	if !c.Driver.Ready || c.Driver.Setup != c.Driver.Setup.Clamp() || c.Driver.Setup == (car.Setup{99, -5, 999, 99, 99, 99}) {
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
