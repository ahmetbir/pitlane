package race

import (
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// contactRace is a race in phase Racing with every car parked far apart on the track,
// except cars 1 (A) and 2 (B), which the caller places. Every car is driven by a human who
// presses nothing (Step(nil)), so cars only coast: no bot steers or brakes them.
func contactRace(mode Contact) *Race {
	r := New(Settings{Handling: car.Arcade, Contact: mode, Laps: 3, Seed: 1}, track.Kiyi())
	for i, c := range r.cars {
		c.Driver.Human = true
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
	put(r, a, 100, 0.8, 30)
	put(r, b, 100, -0.8, 30)
	va, vb := a.St.Speed(), b.St.Speed()
	r.resolveContacts(nil)
	d := math.Hypot(b.St.X-a.St.X, b.St.Z-a.St.Z)
	if d < 2*boxHalfWid-1e-9 || overlapping(a, b) && d < 2*boxHalfWid-1e-6 {
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
	put(r, a, 100, 0.8, 30)
	put(r, b, 100, -0.8, 30)
	b.St.VY = 2
	r.resolveContacts(nil)
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
	if !b.St.Dmg.FrontWingLost() {
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

// latOf is a car's lateral offset from the centreline.
func latOf(r *Race, c *Car) float64 {
	_, lat, _ := r.tr.Locate(c.St.X, c.St.Z, c.Seg)
	return lat
}

func TestContactKeepsCarsOffTheBarrier(t *testing.T) {
	for _, mode := range []Contact{Soft, Full} {
		r := contactRace(mode)
		a, b := r.cars[0], r.cars[1]
		limit := r.tr.WallLat() - halfWidth
		put(r, a, 100, limit, 20)
		put(r, b, 100, limit-1, 20)
		b.St.VY = 3 // shoving A into the wall
		worst := 0.0
		for k := 0; k < 60; k++ {
			r.Step(nil)
			for _, c := range r.cars {
				if lat := math.Abs(latOf(r, c)); lat > limit+1e-9 {
					t.Fatalf("%v tick %d car %d at lat %.6f past %.6f", mode, k, c.ID, lat, limit)
				} else if c.ID == a.ID {
					worst = math.Max(worst, lat)
				}
			}
		}
		t.Logf("%v: A max |lat| %.6f, limit %.6f", mode, worst, limit)
	}
}

func TestDamageDeadZone(t *testing.T) {
	// Side rub at 1 m/s.
	r := contactRace(Full)
	a, b := r.cars[0], r.cars[1]
	put(r, a, 100, 0.9, 30)
	put(r, b, 100, -0.9, 30)
	b.St.VY = 1
	p0 := a.P
	r.resolveContacts(nil)
	if a.St.Dmg != (car.Damage{}) || b.St.Dmg != (car.Damage{}) || a.P != p0 || b.P != p0 {
		t.Fatalf("side rub damage %+v %+v", a.St.Dmg, b.St.Dmg)
	}
	if vy := b.St.VY; vy >= 1 {
		t.Fatalf("rub not resolved: B VY %.3f", vy)
	}

	// Nudge from behind at 2 m/s.
	r = contactRace(Full)
	a, b = r.cars[0], r.cars[1]
	put(r, a, 100, 0, 30)
	put(r, b, 100, 0, 32)
	b.St.X, b.St.Z = a.St.X-5.3*a.St.HX, a.St.Z-5.3*a.St.HZ // 0.1 m overlap
	r.resolveContacts(nil)
	if a.St.Dmg != (car.Damage{}) || b.St.Dmg != (car.Damage{}) || a.P != p0 || b.P != p0 {
		t.Fatalf("nudge damage %+v %+v", a.St.Dmg, b.St.Dmg)
	}
	if b.St.VX >= 32 {
		t.Fatal("nudge not resolved")
	}

	// Rear-end at 12 m/s loses the wing.
	r = contactRace(Full)
	a, b = r.cars[0], r.cars[1]
	put(r, a, 100, 0, 30)
	put(r, b, 94, 0, 42)
	lost := 0
	for k := 0; k < 60; k++ {
		for _, id := range r.Step(nil).WingLost {
			if id == b.ID {
				lost++
			}
		}
	}
	if lost != 1 || !b.St.Dmg.FrontWingLost() {
		t.Fatalf("12 m/s rear-end: lost %d, B %+v", lost, b.St.Dmg)
	}
	t.Logf("12 m/s rear-end: A %+v B %+v", a.St.Dmg, b.St.Dmg)
}

func TestWallDamageFullOnly(t *testing.T) {
	for _, mode := range []Contact{Soft, Full} {
		r := contactRace(mode)
		a := r.cars[0]
		put(r, a, 100, 0, 30)
		h := math.Atan2(a.St.HZ, a.St.HX) + math.Pi/6 // 30° towards the left wall
		a.St.H, a.St.HX, a.St.HZ = h, math.Cos(h), math.Sin(h)
		var lost []CarID
		hit := -1
		for k := 0; k < 300 && hit < 0; k++ {
			lost = append(lost, r.Step(nil).WingLost...)
			if math.Abs(latOf(r, a)) >= r.tr.WallLat()-halfWidth-1e-9 {
				hit = k
			}
		}
		if hit < 0 {
			t.Fatalf("%v: wall never reached", mode)
		}
		damaged := a.St.Dmg != (car.Damage{})
		if damaged != (mode == Full) {
			t.Fatalf("%v: damage %+v", mode, a.St.Dmg)
		}
		if mode == Full && (!a.St.Dmg.FrontWingLost() || len(lost) != 1 ||
			a.P != car.NewParams(r.set.Handling, a.Driver.Setup, a.St.Dmg)) {
			t.Fatalf("full wall hit: %+v lost %v", a.St.Dmg, lost)
		}
		t.Logf("%v: wall at tick %d, damage %+v", mode, hit, a.St.Dmg)
	}
}

// softGap places B behind A at nose-to-tail distance d (centres), both at the given speeds,
// resolves one contact and returns B's speed before and after.
func softGap(d, va, vb float64) (before, after float64, r *Race) {
	r = contactRace(Soft)
	a, b := r.cars[0], r.cars[1]
	put(r, a, 100, 0, va)
	put(r, b, 100, 0, vb)
	b.St.X, b.St.Z = a.St.X-d*a.St.HX, a.St.Z-d*a.St.HZ
	before = b.St.Speed()
	r.resolveContacts(nil)
	return before, b.St.Speed(), r
}

func TestSoftContactFollowsTheBoxes(t *testing.T) {
	// Rear-end at 10 m/s relative: nothing at 6 m, contact once the boxes touch (5.4 m).
	if before, after, _ := softGap(6, 30, 40); after != before {
		t.Fatalf("contact at 6 m nose-to-tail: %.3f → %.3f", before, after)
	}
	if before, after, _ := softGap(5.3, 30, 40); after >= before {
		t.Fatalf("no contact at 5.3 m nose-to-tail: %.3f → %.3f", before, after)
	}
	_, _, r := softGap(5.0, 30, 40)
	a, b := r.cars[0], r.cars[1]
	if overlapping(a, b) {
		t.Fatal("boxes still overlap after resolution")
	}
	if d := math.Hypot(b.St.X-a.St.X, b.St.Z-a.St.Z); math.Abs(d-5.4) > 0.01 {
		t.Fatalf("separated to %.3f m, want 5.4", d)
	}
	if a.St.R != 0 || b.St.R != 0 {
		t.Fatal("soft contact spun a car")
	}

	// Side by side: contact at 1.8 m, none at 2.0 m.
	for _, c := range []struct {
		gap float64
		hit bool
	}{{1.8, true}, {2.0, false}} {
		r := contactRace(Soft)
		a, b := r.cars[0], r.cars[1]
		put(r, a, 100, c.gap/2, 30)
		put(r, b, 100, -c.gap/2, 30)
		b.St.VY = 2
		vy := b.St.VY
		r.resolveContacts(nil)
		if got := b.St.VY != vy; got != c.hit {
			t.Fatalf("side by side at %.1f m: contact %v, want %v", c.gap, got, c.hit)
		}
	}
}
