package car

import (
	"math"
	"testing"
)

var asphalt = Env{Mu: 1}

func with(s Setup, i, v int) Setup { s[i] = v; return s }

func rest() State { return State{HX: 1, Gear: 1} }

func run(h Handling, s Setup, in Input, ticks int) State {
	p := NewParams(h, s, Damage{})
	st := rest()
	for range ticks {
		Step(&st, &p, in, asphalt)
	}
	return st
}

// corner holds ~40 m/s with a throttle/brake P-controller at a fixed steer
// for 10 s. It returns the mean lateral acceleration (v·R) and radius (v/|R|)
// over the last 2 s, and whether the car settled (spread of R < 0.01 rad/s and
// of VY < 0.05 m/s over that window).
func corner(h Handling, s Setup, d Damage, steer float64) (ay, radius float64, steady bool) {
	return cornerAt(h, s, d, steer, 40)
}

func cornerAt(h Handling, s Setup, d Damage, steer, v float64) (ay, radius float64, steady bool) {
	p := NewParams(h, s, d)
	st := rest()
	st.VX = v
	const ticks, tail = 600, 120
	lo, hi := math.Inf(1), math.Inf(-1)
	ylo, yhi := lo, hi
	for i := range ticks {
		e := v - st.Speed()
		in := Input{Steer: steer, Throttle: e * 0.5, Brake: -e * 0.5}
		Step(&st, &p, in.Clean(), asphalt)
		if i >= ticks-tail {
			ay += st.Speed() * math.Abs(st.R)
			radius += st.Speed() / math.Abs(st.R)
			lo, hi = min(lo, st.R), max(hi, st.R)
			ylo, yhi = min(ylo, st.VY), max(yhi, st.VY)
		}
	}
	return ay / tail, radius / tail, hi-lo < 0.01 && yhi-ylo < 0.05
}

// grip is the highest steady-state lateral acceleration at speed v over a
// steer sweep: what the car sustains, not a transient slide.
func grip(h Handling, d Damage, v float64) float64 {
	best := 0.0
	for i := 1; i <= 20; i++ {
		if ay, _, ok := cornerAt(h, DefaultSetup(), d, float64(i)*0.05, v); ok {
			best = max(best, ay)
		}
	}
	return best
}

func TestStraightLineTopSpeedByGearing(t *testing.T) {
	short := run(Sim, with(DefaultSetup(), Gearing, 1), Input{Throttle: 1}, 60*40).Speed()
	long := run(Sim, with(DefaultSetup(), Gearing, 5), Input{Throttle: 1}, 60*40).Speed()
	if !(long > short+5) {
		t.Fatalf("top speed short %.1f long %.1f", short, long)
	}
	if long < 80 || long > 100 {
		t.Fatalf("long top speed %.1f m/s", long)
	} // 290–360 km/h
}

// rolling returns the time to accelerate from 55 to 75 m/s at full throttle,
// starting in the gear the shift logic picks for 55 m/s.
func rolling(gearing int) float64 {
	p := NewParams(Sim, with(DefaultSetup(), Gearing, gearing), Damage{})
	st := rest()
	st.VX = 55
	for st.Gear < 8 && st.VX*p.RPMPerMS[st.Gear-1] > shiftUp {
		st.Gear++
	}
	for i := range 60 * 30 {
		Step(&st, &p, Input{Throttle: 1}, asphalt)
		if st.Speed() >= 75 {
			return float64(i+1) * DT
		}
	}
	return math.Inf(1)
}

// Short gearing (narrow steps) pulls harder in the power-limited range.
func TestShortGearingAcceleratesHarder(t *testing.T) {
	short, long := rolling(1), rolling(5)
	if !(short < long) {
		t.Fatalf("55→75 m/s: gearing 1 %.3f s, gearing 5 %.3f s", short, long)
	}
}

func TestMoreRearWingLowersTopSpeed(t *testing.T) {
	// Long gearing keeps the low-drag car off the rev limiter (gearing 3 tops out at 86.5 m/s).
	long := with(DefaultSetup(), Gearing, 5)
	lo := run(Sim, with(long, RearWing, 1), Input{Throttle: 1}, 60*40).Speed()
	hi := run(Sim, with(long, RearWing, 11), Input{Throttle: 1}, 60*40).Speed()
	if !(hi < lo-3) {
		t.Fatalf("top speed rear wing 1 %.1f, 11 %.1f", lo, hi)
	}
}

// brakeDist brakes from 80 m/s and returns the distance covered and the final speed.
func brakeDist(bias int) (dist, speed float64) {
	p := NewParams(Sim, with(DefaultSetup(), BrakeBias, bias), Damage{})
	st := rest()
	st.VX = 80
	st.Gear = 8
	for range 60 * 10 {
		Step(&st, &p, Input{Brake: 1}, asphalt)
	}
	return st.X, st.Speed()
}

func TestBrakingStopsAndBiasMatters(t *testing.T) {
	d50, v50 := brakeDist(50)
	d70, v70 := brakeDist(70)
	for _, c := range []struct{ d, v float64 }{{d50, v50}, {d70, v70}} {
		if c.v >= 0.5 || c.d > 200 {
			t.Fatalf("bias 50: %.1f m %.2f m/s; bias 70: %.1f m %.2f m/s", d50, v50, d70, v70)
		}
	}
	if math.Abs(d50-d70) < 0.5 {
		t.Fatalf("bias does not matter: 50 → %.2f m, 70 → %.2f m", d50, d70)
	}
}

func TestSteadyCornerUndersteerBySuspension(t *testing.T) {
	_, soft, ok1 := corner(Sim, with(DefaultSetup(), SuspBalance, 1), Damage{}, 0.2)
	_, stiff, ok9 := corner(Sim, with(DefaultSetup(), SuspBalance, 9), Damage{}, 0.2)
	if !ok1 || !ok9 || !(stiff > soft) {
		t.Fatalf("radius susp 1 %.2f m (steady %v), susp 9 %.2f m (steady %v)", soft, ok1, stiff, ok9)
	}
}

func TestSimHoldsSteadyCorner(t *testing.T) {
	for _, steer := range []float64{0.05, 0.1, 0.15, 0.2} {
		for _, sb := range []int{1, 5, 9} {
			if _, r, ok := corner(Sim, with(DefaultSetup(), SuspBalance, sb), Damage{}, steer); !ok || r <= 0 {
				t.Fatalf("steer %.2f susp %d: not steady (radius %.1f)", steer, sb, r)
			}
		}
	}
}

func TestArcadeGripsMoreThanSim(t *testing.T) {
	for _, v := range []float64{25, 40, 60} {
		if arcade, sim := grip(Arcade, Damage{}, v), grip(Sim, Damage{}, v); !(arcade >= sim) {
			t.Fatalf("%.0f m/s: steady lateral accel arcade %.2f sim %.2f", v, arcade, sim)
		}
	}
}

func TestDamageCutsFrontGrip(t *testing.T) {
	if ok, hit := grip(Sim, Damage{}, 40), grip(Sim, Damage{FrontWing: 1}, 40); !(hit < ok) {
		t.Fatalf("steady lateral accel intact %.2f, broken front wing %.2f", ok, hit)
	}
}

type rng uint64

func (r *rng) next() uint64 {
	*r += 0x9e3779b97f4a7c15
	z := uint64(*r)
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

func (r *rng) val(lo, hi float64) float64 {
	switch r.next() % 16 {
	case 0:
		return math.NaN()
	case 1:
		return math.Inf(1)
	case 2:
		return math.Inf(-1)
	case 3:
		return 1e300
	}
	return lo + (hi-lo)*float64(r.next()>>11)/float64(1<<53)
}

func finite(st State) bool {
	for _, v := range []float64{st.X, st.Z, st.H, st.HX, st.HZ, st.VX, st.VY, st.R, st.Delta, st.RPM, st.AX,
		st.Dmg.FrontWing, st.Dmg.RearWing, st.Dmg.Susp} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return false
		}
	}
	return st.Gear >= 1 && st.Gear <= 8
}

func TestNoNaNUnderAbuse(t *testing.T) {
	lo := Setup{1, 1, 50, 1, 1, 1}
	hi := Setup{11, 11, 70, 5, 10, 9}
	envs := []Env{{1, 0}, {0.9, 0}, {0.55, 0.9}}
	r := rng(7)
	for _, h := range []Handling{Arcade, Sim} {
		for mask := range 1 << 6 {
			var s Setup
			for i := range s {
				s[i] = lo[i]
				if mask>>i&1 == 1 {
					s[i] = hi[i]
				}
			}
			d := Damage{float64(mask & 1), float64(mask >> 1 & 1), float64(mask >> 2 & 1)}
			p := NewParams(h, s, d)
			st := rest()
			st.Dmg = d
			in := Input{}
			ticks := 10000
			for i := range ticks {
				if i%20 == 0 {
					in = Input{Throttle: r.val(0, 1), Brake: r.val(0, 1), Steer: r.val(-1, 1)}.Clean()
				}
				Step(&st, &p, in, envs[i/200%3])
				if !finite(st) {
					t.Fatalf("%v setup %v tick %d: %+v", h, s, i, st)
				}
			}
		}
	}
}

func TestInputClean(t *testing.T) {
	got := Input{Throttle: math.NaN(), Brake: 3, Steer: math.Inf(-1)}.Clean()
	if got != (Input{Throttle: 0, Brake: 1, Steer: 0}) {
		t.Fatalf("clean: %+v", got)
	}
	if got := (Input{Throttle: -1, Brake: 0.5, Steer: -7}).Clean(); got != (Input{0, 0.5, -1}) {
		t.Fatalf("clean: %+v", got)
	}
}

func TestSetupClamp(t *testing.T) {
	if got := (Setup{0, 99, -5, 9, 0, 100}).Clamp(); got != (Setup{1, 11, 50, 5, 1, 9}) {
		t.Fatalf("clamp: %v", got)
	}
	if DefaultSetup() != (Setup{6, 6, 58, 3, 5, 5}) || DefaultSetup().Clamp() != DefaultSetup() {
		t.Fatalf("default: %v", DefaultSetup())
	}
}

func TestParseHandling(t *testing.T) {
	for _, h := range []Handling{Arcade, Sim} {
		if got, ok := ParseHandling(h.String()); !ok || got != h {
			t.Fatalf("round trip %v", h)
		}
	}
	if _, ok := ParseHandling("kart"); ok {
		t.Fatal("kart parsed")
	}
}

func TestStepIsDeterministic(t *testing.T) {
	play := func() State {
		p := NewParams(Sim, DefaultSetup(), Damage{})
		st := rest()
		r := rng(42)
		for i := range 60 * 30 {
			in := Input{Throttle: r.val(0, 1), Brake: r.val(0, 0.3), Steer: r.val(-1, 1)}.Clean()
			Step(&st, &p, in, Env{Mu: 1, Drag: float64(i/300%2) * 0.9})
		}
		return st
	}
	a, b := play(), play()
	if a != b {
		t.Fatalf("diverged:\n%+v\n%+v", a, b)
	}
}
