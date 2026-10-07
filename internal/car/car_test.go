package car

import (
	"math"
	"testing"
)

var asphalt = Env{Mu: 1}

func with(s Setup, i, v int) Setup { s[i] = v; return s }

func rest() State { return State{HX: 1, Gear: 1} }

// noTC is the default setup with traction control off: the bare chassis.
// (With TC on, a car at the rear's grip limit is refused the power to hold
// speed, which is what TC is for.)
func noTC() Setup { return with(DefaultSetup(), TC, 0) }

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
// of VY < 0.05 m/s over that window, speed within 1 m/s of v).
func corner(h Handling, s Setup, d Damage, steer float64) (ay, radius float64, steady bool) {
	return cornerAt(h, s, d, steer, 40)
}

func cornerAt(h Handling, s Setup, d Damage, steer, v float64) (ay, radius float64, steady bool) {
	return cornerThr(h, s, d, steer, v, -1)
}

// cornerThr is cornerAt with a fixed throttle when thr ≥ 0 (speed then held by
// the brake alone).
func cornerThr(h Handling, s Setup, d Damage, steer, v, thr float64) (ay, radius float64, steady bool) {
	p := NewParams(h, s, d)
	st := rest()
	st.VX = v
	const ticks, tail = 600, 120
	lo, hi := math.Inf(1), math.Inf(-1)
	ylo, yhi := lo, hi
	for i := range ticks {
		e := v - st.Speed()
		in := Input{Steer: steer, Throttle: e * 2, Brake: -e * 0.5}
		if thr >= 0 {
			in.Throttle = thr
		}
		Step(&st, &p, in.Clean(), asphalt)
		if i >= ticks-tail {
			ay += st.Speed() * math.Abs(st.R)
			radius += st.Speed() / math.Abs(st.R)
			lo, hi = min(lo, st.R), max(hi, st.R)
			ylo, yhi = min(ylo, st.VY), max(yhi, st.VY)
		}
	}
	return ay / tail, radius / tail, hi-lo < 0.01 && yhi-ylo < 0.05 && math.Abs(st.Speed()-v) < 1
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
	prev := st.Speed()
	for i := range 60 * 30 {
		Step(&st, &p, Input{Throttle: 1}, asphalt)
		if v := st.Speed(); v >= 75 {
			// interpolate the crossing within the tick
			return (float64(i) + (75-prev)/(v-prev)) * DT
		}
		prev = st.Speed()
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
	_, soft, ok1 := corner(Sim, with(noTC(), SuspBalance, 1), Damage{}, 0.2)
	_, stiff, ok9 := corner(Sim, with(noTC(), SuspBalance, 9), Damage{}, 0.2)
	if !ok1 || !ok9 || !(stiff > soft) {
		t.Fatalf("radius susp 1 %.2f m (steady %v), susp 9 %.2f m (steady %v)", soft, ok1, stiff, ok9)
	}
}

func TestSimHoldsSteadyCorner(t *testing.T) {
	for _, steer := range []float64{0.05, 0.1, 0.15, 0.2} {
		for _, sb := range []int{1, 5, 9} {
			if _, r, ok := corner(Sim, with(noTC(), SuspBalance, sb), Damage{}, steer); !ok || r <= 0 {
				t.Fatalf("steer %.2f susp %d: not steady (radius %.1f)", steer, sb, r)
			}
		}
	}
}

// The default Sim car takes part throttle mid-corner without spinning: from
// 40 m/s at Steer 0.15 and a fixed pedal (no brake) for 10 s, the yaw rate
// settles and the side slip stays small (the car speeds up on the arc, so VY
// drifts slowly with speed).
func TestDefaultSimCarTakesThrottleMidCorner(t *testing.T) {
	const pedal = 0.5
	p := NewParams(Sim, DefaultSetup(), Damage{})
	st := rest()
	st.VX = 40
	for st.Gear < 8 && st.VX*p.RPMPerMS[st.Gear-1] > shiftUp {
		st.Gear++
	}
	lo, hi := math.Inf(1), math.Inf(-1)
	slip := 0.0
	for i := range 600 {
		Step(&st, &p, Input{Steer: 0.15, Throttle: pedal}, asphalt)
		slip = max(slip, math.Abs(st.VY)/max(st.VX, 1))
		if i >= 480 {
			lo, hi = min(lo, st.R), max(hi, st.R)
		}
	}
	if !(st.VX > 0 && st.R > 0 && hi-lo < 0.01 && slip < 0.1) {
		t.Fatalf("pedal %.2f: VX %.1f VY %.2f R %.3f (spread %.4f) max |VY|/VX %.3f", pedal, st.VX, st.VY, st.R, hi-lo, slip)
	}
}

func TestArcadeGripsMoreThanSim(t *testing.T) {
	for _, v := range []float64{25, 40, 60} {
		if arcade, sim := grip(Arcade, Damage{}, v), grip(Sim, Damage{}, v); !(sim > 0 && arcade >= sim) {
			t.Fatalf("%.0f m/s: steady lateral accel arcade %.2f sim %.2f", v, arcade, sim)
		}
	}
}

func TestDamageCutsFrontGrip(t *testing.T) {
	if ok, hit := grip(Sim, Damage{}, 40), grip(Sim, Damage{FrontWing: 1}, 40); !(hit > 0 && hit < ok) {
		t.Fatalf("steady lateral accel intact %.2f, broken front wing %.2f", ok, hit)
	}
}

// stopTime brakes fully from st and returns the time until speed < 0.5 m/s.
func stopTime(h Handling, st State, limit float64) float64 {
	p := NewParams(h, DefaultSetup(), Damage{})
	for i := range int(limit / DT) {
		if st.Speed() < 0.5 {
			return float64(i) * DT
		}
		Step(&st, &p, Input{Brake: 1}, asphalt)
	}
	return math.Inf(1)
}

func TestSpunCarBrakesSideways(t *testing.T) {
	st := rest()
	st.VY = 15
	if tm := stopTime(Sim, st, 3); tm > 3 {
		t.Fatalf("sideways at 15 m/s did not stop within 3 s")
	}
}

func TestSimSpinThenBrakeStops(t *testing.T) {
	for _, h := range []Handling{Sim, Arcade} {
		p := NewParams(h, noTC(), Damage{}) // Sim spins with TC off
		st := rest()
		st.VX = 40
		for range 90 {
			Step(&st, &p, Input{Steer: 1, Throttle: 1}, asphalt)
		}
		if spun := math.Abs(st.VY) > math.Abs(st.VX); h == Sim && !spun {
			t.Fatalf("sim did not spin: VX %.1f VY %.1f", st.VX, st.VY)
		}
		if tm := stopTime(h, st, 10); tm > 10 {
			t.Fatalf("%v: after a full-lock slide (VX %.1f VY %.1f R %.2f) the car did not stop within 10 s", h, st.VX, st.VY, st.R)
		}
	}
}

func TestRevLimiterNoJitter(t *testing.T) {
	p := NewParams(Sim, with(DefaultSetup(), Gearing, 1), Damage{})
	st := rest()
	flips, last := 0, 0.0
	prev := st.RPM
	for i := range 60 * 40 {
		Step(&st, &p, Input{Throttle: 1}, asphalt)
		if i >= 60*30 {
			if d := st.RPM - prev; d != 0 {
				if d*last < 0 {
					flips++
				}
				last = d
			}
		}
		prev = st.RPM
	}
	if st.Gear != 8 || st.RPM < taperRPM || flips >= 20 {
		t.Fatalf("gear %d rpm %.0f direction changes %d", st.Gear, st.RPM, flips)
	}
}

// With TC off: traction control caps the drive below the diff's traction gain.
func TestDiffTradesTractionForCornering(t *testing.T) {
	accel := func(diff int) float64 {
		p := NewParams(Sim, with(noTC(), Diff, diff), Damage{})
		st := rest()
		st.VX = 20
		for i := range 60 * 20 {
			Step(&st, &p, Input{Throttle: 1}, asphalt)
			if st.Speed() >= 40 {
				return float64(i+1) * DT
			}
		}
		return math.Inf(1)
	}
	if lo, hi := accel(1), accel(10); hi > lo {
		t.Fatalf("20→40 m/s: diff 1 %.3f s, diff 10 %.3f s", lo, hi)
	}
	held := func(diff int) float64 {
		best := 0.0
		for i := 1; i <= 20; i++ {
			if ay, _, ok := cornerThr(Sim, with(noTC(), Diff, diff), Damage{}, float64(i)*0.05, 40, 0.6); ok {
				best = max(best, ay)
			}
		}
		return best
	}
	if lo, hi := held(1), held(10); !(hi > 0 && hi < lo) {
		t.Fatalf("steady lateral accel at throttle 0.6: diff 1 %.2f, diff 10 %.2f", lo, hi)
	}
}

// TestDerivedLiterals recomputes the derived constants with run-time float64
// arithmetic (left to right, one rounding per operation, as JS does).
func TestDerivedLiterals(t *testing.T) {
	half, rho, area, m, g, a, b, l := 0.5, 1.225, 1.5, 798.0, 9.81, cgFront, cgRear, wheelbase
	h, tw, sixty, two, pi, ed, first := cgHeight, trackW, 60.0, 2.0, math.Pi, 0.2, 3.0
	first *= 5.39
	for _, c := range []struct {
		name      string
		lit, want float64
	}{
		{"aeroQ", aeroQ, half * rho * area},
		{"fzF0", fzF0, m * g * b / l},
		{"fzR0", fzR0, m * g * a / l},
		{"transferK", transferK, m * h / l},
		{"latK", latK, h / tw},
		{"rpmPerRad", rpmPerRad, sixty / (two * pi)},
		{"envDragM", envDragM, ed * m},
		{"first gear", gearTable[0][0], first},
	} {
		if math.Float64bits(c.lit) != math.Float64bits(c.want) {
			t.Errorf("%s literal %v, run-time %v", c.name, c.lit, c.want)
		}
	}
}

// TestGearTable regenerates the gear ratio literals: gear 1 fixed, gear 8 per
// setting, geometric in between.
func TestGearTable(t *testing.T) {
	first := 3.0
	first *= 5.39
	tops := []float64{6.13, 5.75, 5.39, 5.05, 4.75}
	for s, top := range tops {
		step := math.Pow(top/first, 1.0/7)
		for g := range 8 {
			if want := first * math.Pow(step, float64(g)); math.Float64bits(gearTable[s][g]) != math.Float64bits(want) {
				t.Errorf("gearing %d gear %d: literal %v, formula %v", s+1, g+1, gearTable[s][g], want)
			}
		}
	}
}

// Coasting with the wheel on full lock must only lose energy (translation and
// yaw), and the car must roll to a stop.
func TestSteeringAddsNoEnergy(t *testing.T) {
	energy := func(st State) float64 {
		return 0.5*mass*(st.VX*st.VX+st.VY*st.VY) + 0.5*yawI*st.R*st.R
	}
	for _, h := range []Handling{Sim, Arcade} {
		p := NewParams(h, DefaultSetup(), Damage{})
		st := rest()
		st.VX = 20
		st.Gear = 4
		stopped := false
		for i := range 60 * 60 {
			e0 := energy(st)
			Step(&st, &p, Input{Steer: 1}, asphalt)
			if e1 := energy(st); e1 > e0*(1+1e-9) {
				t.Fatalf("%v tick %d: energy %.9g → %.9g (VX %.3f VY %.3f R %.3f)", h, i, e0, e1, st.VX, st.VY, st.R)
			}
			if st.Speed() < 2 {
				stopped = true
				break
			}
		}
		if !stopped {
			t.Fatalf("%v: still %.2f m/s after 60 s", h, st.Speed())
		}
	}
}

// The rear brake is capped by the plain rear grip: the diff's traction gain
// applies to drive only. Braking hard with the diff active (pedal 0.6), Diff 10
// must not stop shorter than Diff 1.
func TestBrakeGetsNoDiffGain(t *testing.T) {
	dist := func(diff int) float64 {
		p := NewParams(Sim, with(DefaultSetup(), Diff, diff), Damage{})
		st := rest()
		st.VX, st.Gear = 20, 3
		for range 60 * 10 {
			Step(&st, &p, Input{Throttle: 0.6, Brake: 1}, asphalt)
			if st.VX < 1 {
				break
			}
		}
		return st.X
	}
	if d1, d10 := dist(1), dist(10); d10 < d1 {
		t.Fatalf("braking 20→1 m/s under pedal 0.6: diff 1 %.3f m, diff 10 %.3f m", d1, d10)
	}
}

// The engine pushes forward at any VX sign: a car rolling backwards recovers.
func TestBackwardsRecovers(t *testing.T) {
	p := NewParams(Sim, DefaultSetup(), Damage{})
	st := rest()
	st.VX = -10
	for range 60 * 5 {
		Step(&st, &p, Input{Throttle: 1}, asphalt)
		if st.VX >= 0 {
			return
		}
	}
	t.Fatalf("still VX %.2f after 5 s", st.VX)
}

// A lost front wing (damage > 0.6) costs 70 % of the whole front downforce.
func TestLostFrontWing(t *testing.T) {
	for fw := 1; fw <= 11; fw++ {
		s := with(DefaultSetup(), FrontWing, fw)
		ok := NewParams(Sim, s, Damage{}).AeroF
		lost := NewParams(Sim, s, Damage{FrontWing: 0.61}).AeroF
		if math.Abs(lost/ok-0.3) > 1e-12 {
			t.Fatalf("front wing %d: lost/intact front downforce %.15f", fw, lost/ok)
		}
	}
	ok, hit := grip(Sim, Damage{}, 50), grip(Sim, Damage{FrontWing: 0.61}, 50)
	if !(hit > 0 && hit < ok) {
		t.Fatalf("steady lateral accel at 50 m/s: intact %.2f, wing lost %.2f", ok, hit)
	}
	t.Logf("steady lateral accel at 50 m/s: intact %.2f, wing lost %.2f", ok, hit)
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
	return st.Gear >= 0 && st.Gear <= 8
}

func TestNoNaNUnderAbuse(t *testing.T) {
	lo := Setup{1, 1, 50, 1, 1, 1, 0}
	hi := Setup{11, 11, 70, 5, 10, 9, 3}
	envs := []Env{{1, 0}, {0.9, 0}, {0.55, 0.9}}
	r := rng(7)
	for _, h := range []Handling{Arcade, Sim} {
		for mask := range 1 << 7 {
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
					in = Input{Throttle: r.val(0, 1), Brake: r.val(0, 1), Steer: r.val(-1, 1), Reverse: r.next()%4 == 0}.Clean()
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
	got := Input{Throttle: math.NaN(), Brake: 3, Steer: math.Inf(-1), Reverse: true}.Clean()
	if got != (Input{Throttle: 0, Brake: 1, Steer: 0, Reverse: true}) {
		t.Fatalf("clean: %+v", got)
	}
	if got := (Input{Throttle: -1, Brake: 0.5, Steer: -7}).Clean(); got != (Input{Brake: 0.5, Steer: -1}) {
		t.Fatalf("clean: %+v", got)
	}
}

func TestSetupClamp(t *testing.T) {
	if got := (Setup{0, 99, -5, 9, 0, 100, -1}).Clamp(); got != (Setup{1, 11, 50, 5, 1, 9, 0}) {
		t.Fatalf("clamp: %v", got)
	}
	if got := (Setup{6, 6, 58, 3, 5, 5, 4}).Clamp(); got[TC] != 3 {
		t.Fatalf("clamp TC: %v", got)
	}
	if DefaultSetup() != (Setup{6, 6, 58, 3, 5, 5, 2}) || DefaultSetup().Clamp() != DefaultSetup() {
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

// keyboardSlip: a keyboard holds full throttle and slews the steer to full
// lock at 3/s for hold seconds (back at 5/s), from v0 after 2 s at half
// throttle. It returns the largest side-slip angle (degrees) over 6 s, and
// whether VX went negative (a spin).
func keyboardSlip(h Handling, su Setup, v0, hold float64) (slip float64, spun bool) {
	p := NewParams(h, su, Damage{})
	st := State{HX: 1, VX: v0, Gear: 1}
	for i := 0; i < 120; i++ {
		Step(&st, &p, Input{Throttle: 0.5}, Env{Mu: 1})
	}
	steer := 0.0
	for i := 0; i < 360; i++ {
		target := 0.0
		if float64(i)*DT < hold {
			target = 1
		}
		rate := 3.0
		if target == 0 {
			rate = 5
		}
		steer += math.Max(-rate*DT, math.Min(rate*DT, target-steer))
		Step(&st, &p, Input{Throttle: 1, Steer: math.Round(steer*127) / 127}, Env{Mu: 1})
		slip = max(slip, math.Abs(math.Atan2(st.VY, math.Max(st.VX, 0.1)))*180/math.Pi)
		spun = spun || st.VX < 0
	}
	return slip, spun
}

// In Arcade a keyboard's full throttle must never spin the car, whatever the
// differential: the traction control leaves rear grip and the diff acts on
// real traction.
func TestArcadeKeyboardFullThrottleTurnsWithoutSpinning(t *testing.T) {
	for _, diff := range []int{1, 5, 10} {
		for _, v0 := range []float64{25, 40, 60} {
			for _, hold := range []float64{0.2, 1.5} {
				if slip, spun := keyboardSlip(Arcade, with(DefaultSetup(), Diff, diff), v0, hold); slip > 20 || spun {
					t.Fatalf("diff %d v0 %.0f hold %.1fs: slip %.1f° (spin)", diff, v0, hold, slip)
				}
			}
		}
	}
}

// Sim traction control level 3 keeps a keyboard's full throttle from
// spinning the car at 25/40/60 m/s; with TC off the same driving spins it.
func TestSimTCLevels(t *testing.T) {
	worst := [4]float64{}
	for tc := 0; tc <= 3; tc++ {
		for _, diff := range []int{1, 5, 10} {
			for _, v0 := range []float64{25, 40, 60} {
				for _, hold := range []float64{0.2, 1.5} {
					slip, spun := keyboardSlip(Sim, with(with(DefaultSetup(), Diff, diff), TC, tc), v0, hold)
					if spun {
						slip = 180
					}
					worst[tc] = max(worst[tc], slip)
					t.Logf("TC %d diff %2d v0 %2.0f hold %.1f: max slip %5.1f° spun %v", tc, diff, v0, hold, slip, spun)
					if tc == 3 && (slip > 20 || spun) {
						t.Errorf("TC 3 diff %d v0 %.0f hold %.1fs: slip %.1f° (spin)", diff, v0, hold, slip)
					}
				}
			}
		}
	}
	if !(worst[0] > 20) {
		t.Errorf("TC off never spins (worst slip %.1f°): the levels do not differ", worst[0])
	}
	t.Logf("worst slip by level 0..3: %.1f°", worst)
	// The price: on a straight, each level pulls away from rest a little slower.
	prev := 0.0
	for tc := 0; tc <= 3; tc++ {
		tm := zeroTo(Sim, with(DefaultSetup(), TC, tc), 100/3.6, false)
		t.Logf("TC %d: 0–100 km/h %.3f s", tc, tm)
		if !(tm >= prev) {
			t.Errorf("TC %d: 0–100 km/h %.3f s, quicker than the level below (%.3f s)", tc, tm, prev)
		}
		prev = tm
	}
}

// zeroTo returns the time from rest to speed v at full throttle; with launch,
// the brake is held with full throttle for 1.5 s first (not counted).
func zeroTo(h Handling, su Setup, v float64, launch bool) float64 {
	p := NewParams(h, su, Damage{})
	st := rest()
	if launch {
		for range 90 {
			Step(&st, &p, Input{Throttle: 1, Brake: 1}, asphalt)
		}
	}
	prev := st.Speed()
	for i := range 60 * 20 {
		Step(&st, &p, Input{Throttle: 1}, asphalt)
		if s := st.Speed(); s >= v {
			return (float64(i) + (v-prev)/(s-prev)) * DT
		}
		prev = st.Speed()
	}
	return math.Inf(1)
}

// Reverse from rest at full throttle: the car backs up to about revTop and
// holds it, in gear 0, in both handlings.
func TestReverseTopSpeed(t *testing.T) {
	for _, h := range []Handling{Sim, Arcade} {
		p := NewParams(h, DefaultSetup(), Damage{})
		st := rest()
		lo, hi := math.Inf(1), math.Inf(-1)
		for i := range 60 * 6 {
			Step(&st, &p, Input{Throttle: 1, Reverse: true}, asphalt)
			if i >= 60*4 {
				lo, hi = min(lo, st.VX), max(hi, st.VX)
			}
		}
		t.Logf("%v: reverse VX %.3f .. %.3f m/s, gear %d, x %.2f m", h, lo, hi, st.Gear, st.X)
		if st.Gear != 0 || lo < -8.5 || hi > -7.5 || st.X > -30 {
			t.Fatalf("%v: reverse VX %.3f .. %.3f, gear %d, x %.2f", h, lo, hi, st.Gear, st.X)
		}
	}
}

// Steering reverses with the direction of travel: left lock turns the car
// left (R > 0) going forward and right (R < 0) backing up.
func TestReverseSteersTheOtherWay(t *testing.T) {
	for _, h := range []Handling{Sim, Arcade} {
		p := NewParams(h, DefaultSetup(), Damage{})
		back := rest()
		for range 60 * 3 {
			Step(&back, &p, Input{Throttle: 1, Reverse: true}, asphalt)
		}
		fwd := rest()
		fwd.VX = 8
		for range 60 {
			Step(&back, &p, Input{Throttle: 0.5, Reverse: true, Steer: 1}, asphalt)
			Step(&fwd, &p, Input{Throttle: 0.2, Steer: 1}, asphalt)
		}
		t.Logf("%v: left lock forward R %.3f, backwards R %.3f (VX %.2f, VY %.2f)", h, fwd.R, back.R, back.VX, back.VY)
		if !(fwd.R > 0.3 && back.R < -0.3 && back.VX < -3) || math.Abs(back.VY) > 2.5 {
			t.Fatalf("%v: forward R %.3f, backwards R %.3f VX %.2f VY %.2f", h, fwd.R, back.R, back.VX, back.VY)
		}
	}
}

// Reverse selected while rolling forward brakes the car to a stop first,
// then backs up; without Reverse the brakes never push the car backwards.
func TestReverseWhileRollingForwardBrakes(t *testing.T) {
	p := NewParams(Sim, DefaultSetup(), Damage{})
	st := rest()
	st.VX, st.Gear = 20, 3
	prev, stopped := st.VX, -1
	for i := range 60 * 8 {
		Step(&st, &p, Input{Throttle: 1, Reverse: true}, asphalt)
		if st.VX > prev+1e-9 && st.VX > 0 {
			t.Fatalf("tick %d: VX rose %.3f → %.3f with reverse selected", i, prev, st.VX)
		}
		if stopped < 0 && st.VX <= 0 {
			stopped = i
		}
		prev = st.VX
	}
	if stopped < 0 || st.VX > -7 || st.Gear != 0 {
		t.Fatalf("stopped at tick %d, VX %.2f gear %d", stopped, st.VX, st.Gear)
	}
	t.Logf("20 m/s → stop in %.2f s, then VX %.2f", float64(stopped)*DT, st.VX)
	held := rest()
	for range 60 {
		Step(&held, &p, Input{Brake: 1}, asphalt)
	}
	if held.VX != 0 || held.X != 0 || held.Gear != 1 {
		t.Fatalf("brake at rest: VX %v X %v gear %d", held.VX, held.X, held.Gear)
	}
}
