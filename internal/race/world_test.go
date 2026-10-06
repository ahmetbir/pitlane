package race

import (
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

func finite(st car.State) bool {
	for _, v := range []float64{st.X, st.Z, st.HX, st.HZ, st.VX, st.VY, st.R, st.RPM} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return true
}

// carAt places a car at lat on seg 0 heading at angle a (rad) from the tangent, speed v.
func carAt(tr *track.Track, lat, a, v float64) (car.State, int) {
	g := tr.Segs[0]
	x, z := tr.Point(g.S, lat)
	hx := math.Cos(a)*g.TX + math.Sin(a)*g.NX
	hz := math.Cos(a)*g.TZ + math.Sin(a)*g.NZ
	return car.State{X: x, Z: z, HX: hx, HZ: hz, H: math.Atan2(hz, hx), VX: v, Gear: 6, RPM: 11000}, 0
}

func TestWallKeepsCarInside(t *testing.T) {
	tr := track.Kiyi()
	p := car.NewParams(car.Sim, car.DefaultSetup(), car.Damage{})
	st, hint := carAt(tr, 0, math.Pi/6, 90)
	lim := tr.WallLat() - 1 + 1e-9
	for k := 0; k < 1000; k++ {
		moveCar(&st, &p, car.Input{Throttle: 1}, tr, &hint)
		_, lat, _ := tr.Locate(st.X, st.Z, hint)
		if math.Abs(lat) > lim {
			t.Fatalf("tick %d: lat %v beyond %v", k, lat, lim)
		}
		if !finite(st) {
			t.Fatalf("tick %d: non-finite state", k)
		}
	}
}

func TestGrassSlowsTheCar(t *testing.T) {
	tr := track.Kiyi()
	p := car.NewParams(car.Sim, car.DefaultSetup(), car.Damage{})
	run := func(lat float64) float64 {
		st, hint := carAt(tr, lat, 0, 30)
		for k := 0; k < 300; k++ {
			moveCar(&st, &p, car.Input{Throttle: 1}, tr, &hint)
		}
		return st.Speed()
	}
	asphalt, grass := run(0), run(tr.Width/2+5)
	if !(grass < asphalt-10) {
		t.Fatalf("grass %v not 10 below asphalt %v", grass, asphalt)
	}
}

func TestWallImpulseReported(t *testing.T) {
	tr := track.Kiyi()
	p := car.NewParams(car.Sim, car.DefaultSetup(), car.Damage{})
	st, hint := carAt(tr, 0, math.Pi/6, 90)
	hit := 0.0
	for k := 0; k < 1000 && hit == 0; k++ {
		hit = moveCar(&st, &p, car.Input{Throttle: 1}, tr, &hint)
	}
	if hit <= 0 {
		t.Fatal("no impulse on first contact")
	}
	st, hint = carAt(tr, tr.WallLat()-1.5, 0, 50)
	for k := 0; k < 10; k++ {
		if w := moveCar(&st, &p, car.Input{}, tr, &hint); w != 0 {
			t.Fatalf("parallel car reported impulse %v", w)
		}
	}
}
