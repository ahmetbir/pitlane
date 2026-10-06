package race

import (
	"math"
	"slices"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
)

// marshalRace is a Racing race (timedRace) in which only car 1 races: every other car is
// finished and parked out on the grass, so it is neither reset nor in car 1's way.
func marshalRace() (*Race, *Car) {
	r := timedRace()
	for _, c := range r.cars[1:] {
		put(r, c, c.S, -15, 0)
		c.Finished = true
	}
	return r, r.cars[0]
}

func TestMarshalResetsCarStuckOnWall(t *testing.T) {
	r, a := marshalRace()
	lim := r.tr.WallLat() - halfWidth
	put(r, a, 100, lim, 0)
	a.St.HX, a.St.HZ = a.St.HZ*-1, a.St.HX // turn 90° left: nose into the left wall
	a.St.H = math.Atan2(a.St.HZ, a.St.HX)
	a.St.Gear = 1
	push := map[CarID]car.Input{a.ID: {Throttle: 0.3}}
	for k := 1; k <= resetTicks; k++ {
		ev := r.Step(push)
		if got := slices.Contains(ev.Reset, a.ID); got != (k == resetTicks) {
			t.Fatalf("tick %d: reset %v (speed %.2f)", k, got, a.St.Speed())
		}
	}
	i, lat, _ := r.tr.Locate(a.St.X, a.St.Z, a.Seg)
	if math.Abs(lat-r.tr.Line[i]) > 0.05 || a.St.Speed() != 0 || a.St.HX*r.tr.Segs[i].TX+a.St.HZ*r.tr.Segs[i].TZ < 0.999 {
		t.Fatalf("after reset: lat %.2f line %.2f speed %.2f", lat, r.tr.Line[i], a.St.Speed())
	}

	r.Unseat(a.ID) // a bot drives it on
	for k := 0; k < 150*tps && a.Lap == 0; k++ {
		r.Step(nil)
	}
	if a.Lap != 1 {
		t.Fatalf("no lap after the reset: s %.1f sector %d", a.S, a.Sector)
	}
}

func TestMarshalIgnoresShortStops(t *testing.T) {
	r, a := marshalRace()
	put(r, a, 100, 0, 0)
	a.St.Gear = 1
	step := func(in car.Input) {
		if ev := r.Step(map[CarID]car.Input{a.ID: in}); slices.Contains(ev.Reset, a.ID) {
			t.Fatalf("reset at tick %d (slow %d)", r.Tick(), a.slow)
		}
	}
	for range resetTicks - 50 {
		step(car.Input{})
	}
	for a.St.Speed() < 2 {
		step(car.Input{Throttle: 1})
	}
	for a.St.Speed() > 0 {
		step(car.Input{Brake: 1})
	}
	for range resetTicks - 50 { // the count started again when the car moved
		step(car.Input{})
	}
}

func TestMarshalNeverResetsFinishedCars(t *testing.T) {
	r, a := marshalRace()
	put(r, a, 100, 0, 0)
	a.Finished = true
	for k := 0; k < 3*resetTicks; k++ {
		if ev := r.Step(nil); len(ev.Reset) > 0 {
			t.Fatalf("tick %d: reset %v", k, ev.Reset)
		}
	}
}
