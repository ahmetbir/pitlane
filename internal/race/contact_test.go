package race

import (
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// contactRace is a race in phase Racing with every car parked far apart on the track,
// except cars 1 (A) and 2 (B), which the caller places.
func contactRace(mode Contact) *Race {
	r := New(Settings{Handling: car.Arcade, Contact: mode, Laps: 3, Seed: 1}, track.Kiyi())
	for i, c := range r.cars {
		x, z := r.tr.Point(r.tr.Length*float64(i)/numCars+50, 0)
		c.St.X, c.St.Z = x, z
		c.Seg, _, _ = r.tr.Locate(x, z, -1)
	}
	r.phase = Racing
	return r
}

// put places car c at lat on the tangent at s with forward speed v.
func put(r *Race, c *Car, s, lat, v float64) {
	g := r.tr.Segs[int(math.Round(s/2))%len(r.tr.Segs)]
	x, z := r.tr.Point(g.S, lat)
	c.St = car.State{X: x, Z: z, H: math.Atan2(g.TZ, g.TX), HX: g.TX, HZ: g.TZ, VX: v, Gear: 6, RPM: 11000}
	c.Seg, _, _ = r.tr.Locate(x, z, -1)
}

// along returns how far b is ahead of a along a's heading.
func along(a, b *Car) float64 { return (b.St.X-a.St.X)*a.St.HX + (b.St.Z-a.St.Z)*a.St.HZ }

func overlapping(a, b *Car) bool {
	_, hit := satOBB(boxOf(&a.St), boxOf(&b.St))
	return hit
}

func TestGhostCarsPassThrough(t *testing.T) {
	r := contactRace(Ghost)
	a, b := r.cars[0], r.cars[1]
	put(r, a, 100, 0, 30)
	put(r, b, 92, 0, 50)
	for k := 0; k < 60; k++ {
		r.Step(nil)
	}
	if along(a, b) < 5.4 {
		t.Fatalf("B did not pass through A: %.2f m ahead", along(a, b))
	}
	if a.St.Dmg != (car.Damage{}) || b.St.Dmg != (car.Damage{}) {
		t.Fatalf("ghost damage %+v %+v", a.St.Dmg, b.St.Dmg)
	}
}

func TestSoftSeparatesWithoutDamage(t *testing.T) {
	r := contactRace(Soft)
	a, b := r.cars[0], r.cars[1]
	put(r, a, 100, 1, 30)
	put(r, b, 100, -1, 30)
	va, vb := a.St.Speed(), b.St.Speed()
	r.resolveContacts()
	d := math.Hypot(b.St.X-a.St.X, b.St.Z-a.St.Z)
	if d < 2*softRadius-1e-9 {
		t.Fatalf("still overlapping: %.4f m", d)
	}
	if a.St.Dmg != (car.Damage{}) || b.St.Dmg != (car.Damage{}) {
		t.Fatalf("soft damage %+v %+v", a.St.Dmg, b.St.Dmg)
	}
	for _, c := range []struct {
		name   string
		v0, v1 float64
	}{{"A", va, a.St.Speed()}, {"B", vb, b.St.Speed()}} {
		if c.v1 >= c.v0 || c.v1 < 0.95*c.v0-1e-9 {
			t.Fatalf("%s speed %.4f → %.4f", c.name, c.v0, c.v1)
		}
		t.Logf("%s speed %.4f → %.4f (%.2f %%)", c.name, c.v0, c.v1, 100*(1-c.v1/c.v0))
	}
	t.Logf("separation %.4f m", d)

	// Drifting into each other: the approaching normal velocity is removed.
	put(r, a, 100, 1, 30)
	put(r, b, 100, -1, 30)
	b.St.VY = 2
	r.resolveContacts()
	n := vec{a.St.X - b.St.X, a.St.Z - b.St.Z}
	if vn := worldVel(&a.St).sub(worldVel(&b.St)).dot(n); vn < -1e-9 {
		t.Fatalf("still approaching: %.4f", vn)
	}
	if a.St.Dmg != (car.Damage{}) || b.St.Dmg != (car.Damage{}) {
		t.Fatal("soft damage while drifting")
	}
}

func TestFullRearEndDamagesFrontWingOfChaser(t *testing.T) {
	r := contactRace(Full)
	a, b := r.cars[0], r.cars[1]
	put(r, a, 100, 0, 30)
	put(r, b, 94, 0, 50)
	hit := -1
	for k := 0; k < 120 && (hit < 0 || k < hit+5); k++ {
		r.Step(nil)
		if hit < 0 && b.St.Dmg != (car.Damage{}) {
			hit = k
		}
	}
	if hit < 0 {
		t.Fatal("no contact")
	}
	if b.St.Dmg.FrontWing <= 0 || a.St.Dmg.RearWing <= 0 {
		t.Fatalf("damage A %+v B %+v", a.St.Dmg, b.St.Dmg)
	}
	if overlapping(a, b) {
		t.Fatal("overlap 5 ticks after contact")
	}
	for _, c := range r.cars {
		if !finite(c.St) {
			t.Fatalf("car %d not finite: %+v", c.ID, c.St)
		}
	}
	t.Logf("hit at tick %d; A %+v B %+v; gap %.3f m; speeds A %.2f B %.2f",
		hit, a.St.Dmg, b.St.Dmg, along(b, a)-5.4, a.St.Speed(), b.St.Speed())
}

func TestFullWingLostEvent(t *testing.T) {
	r := contactRace(Full)
	a, b := r.cars[0], r.cars[1]
	put(r, a, 100, 0, 20)
	put(r, b, 94, 0, 60)
	p0 := b.P
	lost := map[CarID]int{}
	for k := 0; k < 120; k++ {
		for _, id := range r.Step(nil).WingLost {
			lost[id]++
		}
	}
	if lost[b.ID] != 1 || len(lost) != 1 {
		t.Fatalf("wing lost events %v (B front %.3f, A front %.3f)", lost, b.St.Dmg.FrontWing, a.St.Dmg.FrontWing)
	}
	if b.St.Dmg.FrontWing <= wingLost {
		t.Fatalf("B front wing %.3f", b.St.Dmg.FrontWing)
	}
	if b.P == p0 || b.P != car.NewParams(r.set.Handling, b.Driver.Setup, b.St.Dmg) {
		t.Fatal("params not rebuilt from damage")
	}
}

func TestContactNotDuringLights(t *testing.T) {
	r := contactRace(Full)
	r.phase = Lights
	a, b := r.cars[0], r.cars[1]
	put(r, a, 100, 0, 0)
	put(r, b, 97, 0, 0)
	before := a.St.X
	r.Step(nil)
	if a.St.Dmg != (car.Damage{}) || b.St.Dmg != (car.Damage{}) || math.Abs(a.St.X-before) > 0.1 {
		t.Fatal("contact resolved during lights")
	}
}

func TestContactDeterministic(t *testing.T) {
	for _, mode := range []Contact{Soft, Full} {
		run := func() []car.State {
			r := contactRace(mode)
			put(r, r.cars[0], 100, 0.5, 30)
			put(r, r.cars[1], 95, -0.5, 55)
			put(r, r.cars[2], 98, -2, 40)
			r.cars[2].St.VY = 4
			r.cars[2].St.R = 0.5
			for k := 0; k < 180; k++ {
				r.Step(nil)
			}
			out := make([]car.State, 0, numCars)
			for _, c := range r.cars {
				out = append(out, c.St)
			}
			return out
		}
		x, y := run(), run()
		for i := range x {
			if x[i] != y[i] {
				t.Fatalf("%v car %d differs: %+v vs %+v", mode, i+1, x[i], y[i])
			}
			if !finite(x[i]) {
				t.Fatalf("%v car %d not finite", mode, i+1)
			}
		}
	}
}
