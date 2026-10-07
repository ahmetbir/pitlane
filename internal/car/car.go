// Package car is Pitlane's vehicle model: a dynamic bicycle model stepped at a
// fixed 60 Hz. Step uses only + − × ÷ sqrt and comparisons, and materialises
// every product (float64(a*b)) so Go cannot fuse it into an FMA; NewParams does
// the same and takes derived constants as literals. The TS port in
// client/src/car replays Go-written vectors.
package car

import "math"

// DT is one simulation step.
const DT = 1.0 / 60

// Handling selects the parameter set: same model, different grip and assists.
type Handling uint8

const (
	Arcade Handling = iota
	Sim
)

func ParseHandling(s string) (Handling, bool) {
	switch s {
	case "arcade":
		return Arcade, true
	case "sim":
		return Sim, true
	}
	return Arcade, false
}

func (h Handling) String() string {
	if h == Sim {
		return "sim"
	}
	return "arcade"
}

// Setup is the garage setup, indexed by FrontWing … TC.
type Setup [7]int

const (
	FrontWing = iota
	RearWing
	BrakeBias
	Gearing
	Diff
	SuspBalance
	TC // traction control level: 0 off, 1..3 (Arcade always acts as 3)
)

var setupMin, setupMax = Setup{1, 1, 50, 1, 1, 1, 0}, Setup{11, 11, 70, 5, 10, 9, 3}

func DefaultSetup() Setup { return Setup{6, 6, 58, 3, 5, 5, 2} }

// tcShares[level] is the share of the rear capacity the drive may ask for; 0 is
// no limit (traction control off).
var tcShares = [4]float64{0, 1.00, 0.90, tcShare}

func (s Setup) Clamp() Setup {
	for i := range s {
		s[i] = min(max(s[i], setupMin[i]), setupMax[i])
	}
	return s
}

// Damage is 0 (intact) .. 1 (broken) per part.
type Damage struct{ FrontWing, RearWing, Susp float64 }

// FrontWingLost reports whether the front wing is gone (damage above 0.6).
func (d Damage) FrontWingLost() bool { return d.FrontWing > wingLost }

// Input is one tick of driver input: Throttle 0..1, Brake 0..1, Steer -1..1
// (left +). Reverse selects the reverse gear, which the throttle drives while
// the car is (nearly) stopped or rolling backwards; rolling forward, the
// throttle then brakes.
type Input struct {
	Throttle, Brake, Steer float64
	Reverse                bool
}

func (in Input) Clean() Input {
	return Input{Throttle: clean(in.Throttle, 0, 1), Brake: clean(in.Brake, 0, 1), Steer: clean(in.Steer, -1, 1), Reverse: in.Reverse}
}

func clean(v, lo, hi float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return min(max(v, lo), hi)
}

// Env is the surface under the car: grip multiplier and extra drag
// (asphalt {1,0}, kerb {0.9,0}, grass {0.55,0.9}).
type Env struct{ Mu, Drag float64 }

// State is one car. (HX, HZ) is the unit heading vector the step integrates;
// H is the accumulated heading angle, for display only. AX is the last step's
// body longitudinal acceleration (m/s²); it drives longitudinal load transfer,
// so it is part of the replayable state. Dmg is bookkeeping only: damage
// reaches the model through NewParams, so callers rebuild Params whenever Dmg
// changes.
type State struct {
	X, Z, H   float64 // m, m, rad
	HX, HZ    float64 // unit heading; body left is (−HZ, HX)
	VX, VY, R float64 // body forward, body left (m/s), yaw rate (rad/s, CCW +)
	Delta     float64 // front wheel angle (rad, left +)
	RPM       float64
	Gear      int // 1..8; 0 is reverse
	AX        float64
	Dmg       Damage
}

func (st State) Speed() float64 { return math.Sqrt(float64(st.VX*st.VX) + float64(st.VY*st.VY)) }

// Mass is the car mass (kg), exported for collision impulses.
const Mass = 798.0

// Iz is the yaw inertia (kg·m²), exported for collision impulses.
const Iz = yawI

// Model constants.
const (
	mass       = Mass
	wheelbase  = 3.6
	cgFront    = 1.98 // a: CG → front axle (≈45 % front static)
	cgRear     = 1.62 // b: CG → rear axle
	cgHeight   = 0.3
	yawI       = 1100.0
	trackW     = 1.6
	gravity    = 9.81
	rho        = 1.225
	refArea    = 1.5
	cdBase     = 0.70
	cdPerStep  = 0.035
	wheelR     = 0.33
	shiftUp    = 12800.0
	shiftDown  = 8000.0
	idleRPM    = 4000.0
	limitRPM   = 13500.0
	taperRPM   = 13300.0 // torque tapers linearly to 0 between taperRPM and limitRPM
	clRearBase = 1.5     // rear C_L at RearWing 1 (tuned from 1.2 for Sim stability)
	simAlphaR  = 0.11    // Sim rear αpk
	arcAlphaR  = 0.15    // Arcade rear αpk
	brakeMax   = 30e3
	rollRes    = 120.0
	steerLock  = 0.30
	latLoss    = 0.12  // grip loss per unit of lateral transfer / axle load
	suspLoss   = 0.15  // grip loss at Dmg.Susp = 1
	minLoad    = 0.1   // axle load floor, × static load
	wingLost   = 0.6   // Dmg.FrontWing above this: the wing is gone
	lostWingCL = 0.3   // front C_L factor with the wing gone
	lowSpeed   = 1.0   // below this total speed lateral force blends to 0
	slipCap    = 0.6   // slip angle clamp (rad)
	slipVX     = 3.0   // slip denominator floor (m/s)
	yawDamp    = 0.9   // low-speed yaw damping per step
	yawCapK    = 1.15  // Arcade yaw cap margin over available lateral grip
	arcadeVX   = 60.0  // Arcade steer scaling speed
	revEngage  = 0.5   // reverse engages below this VX (m/s)
	revTop     = 8.0   // reverse drive cuts out beyond this backward speed (m/s)
	tcCut      = 0.5   // Arcade TC throttle factor
	tcShare    = 0.8   // TC level 3 (and Arcade): drive ≤ this share of the rear capacity
	absCut     = 0.6   // Arcade ABS brake factor
	tcSlip     = 0.9   // TC engages above this fraction of αpk (rear)
	diffOn     = 0.3   // diff lock acts above this mapped throttle (pedal²)
	diffStep   = 0.015 // rear lateral capacity loss per diff step × traction share
	diffGrip   = 0.03  // rear longitudinal capacity gain per diff step under throttle
	latFront0  = 0.3   // front share of lateral transfer at SuspBalance 1
	latFrontK  = 0.05  // … per SuspBalance step
)

// Derived constants, written as the doubles that step-by-step float64
// arithmetic produces (Go folds constant expressions exactly, JS does not);
// TestDerivedLiterals recomputes each one at run time.
const (
	aeroQ     = 0.9187500000000001  // 0.5·ρ·A
	fzF0      = 3522.771            // m·g·b/L
	fzR0      = 4305.6089999999995  // m·g·a/L
	transferK = 66.49999999999999   // m·hcg/L
	latK      = 0.18749999999999997 // hcg/track width
	rpmPerRad = 9.549296585513721   // 60/(2π)
	envDragM  = 159.60000000000002  // 0.2·m: Env.Drag → linear drag (N per m/s)
)

var (
	torqueRPM = [5]float64{4000, 7000, 10500, 12500, 13500}
	torqueNm  = [5]float64{430, 560, 600, 540, 470}

	// gearTable[Gearing-1] holds the overall ratio of gears 1..8. Gear 1 is
	// 3.0·5.39 for every setting; gear 8 is {6.13, 5.75, 5.39, 5.05, 4.75}; gears
	// 2..7 are geometric between them, so long gearing means wider steps and a
	// bigger rpm drop after each upshift. Literals so the TS port matches bit for
	// bit (TestGearTable regenerates them).
	gearTable = [5][8]float64{
		{16.169999999999998, 14.077693756915655, 12.256120068862218, 10.670247679494764, 9.289578178254004, 8.08755947584331, 7.0410751726508, 6.129999999999999},
		{16.169999999999998, 13.94958018798571, 12.034062301857974, 10.381578049906228, 8.956008378787832, 7.726194003968631, 6.665254347946494, 5.750000000000001},
		{16.169999999999998, 13.82133013649865, 11.813801282751133, 10.09786318465644, 8.631162693155987, 7.377498394801466, 6.305927080769321, 5.389999999999999},
		{16.169999999999998, 13.69327584116387, 11.595906200507242, 9.81978616152184, 8.315710612922839, 7.042011084603978, 5.963401376500671, 5.050000000000001},
		{16.169999999999998, 13.573994709262424, 11.394763906436875, 9.565396721043202, 8.02972445785013, 6.740595999238883, 5.658430082309467, 4.750000000000003},
	}
)

// Params holds every constant Step needs, derived once per car.
type Params struct {
	Mu             float64 // handling grip
	AlphaF, AlphaR float64 // peak slip (rad)
	SteerRate      float64 // rad/s
	Assists        bool    // Arcade: steer scaling, reactive TC, ABS, yaw cap
	TCShare        float64 // predictive TC share, 0 = off (Sim: of the rear friction circle left; Arcade: of the rear capacity)

	AeroF, AeroR float64 // downforce per v² (N·s²/m²)
	DragK        float64 // aero drag per v² (N·s²/m²)
	FzF0, FzR0   float64 // static axle loads (N)
	Transfer     float64 // m·hcg/L
	BrakeF       float64 // front brake force at Brake 1 (N)
	BrakeR       float64
	Drive        [8]float64 // wheel force per Nm of engine torque, per gear
	RPMPerMS     [8]float64 // engine rpm per m/s, per gear
	DiffK        float64    // 0.04·(Diff−1): rear lateral loss per unit mapped throttle
	DiffX        float64    // 0.03·(Diff−1): rear longitudinal gain under throttle
	LatF         float64    // front share of lateral transfer
	LatK         float64    // hcg/track width
	GripDmg      float64    // suspension damage grip factor
}

func NewParams(h Handling, s Setup, d Damage) Params {
	s = s.Clamp()
	d = Damage{clean(d.FrontWing, 0, 1), clean(d.RearWing, 0, 1), clean(d.Susp, 0, 1)}
	p := Params{Mu: 1.00, AlphaF: 0.10, AlphaR: simAlphaR, SteerRate: 2.5, TCShare: tcShares[s[TC]]}
	if h == Arcade {
		p = Params{Mu: 1.25, AlphaF: 0.14, AlphaR: arcAlphaR, SteerRate: 4.0, Assists: true, TCShare: tcShare}
	}
	// Every product feeding a sum is materialised; see the package comment.
	fw, rw := float64(s[FrontWing]-1), float64(s[RearWing]-1)
	clF := 0.9 + float64(float64(0.22*fw)*(1-float64(0.7*d.FrontWing)))
	if d.FrontWingLost() {
		// Wing gone: the whole front downforce (base + setting) drops 70 %.
		clF = float64((0.9 + float64(0.22*fw)) * lostWingCL)
	}
	clR := clRearBase + float64(float64(0.26*rw)*(1-float64(0.7*d.RearWing)))
	p.AeroF, p.AeroR = aeroQ*clF, aeroQ*clR
	p.DragK = aeroQ * (cdBase + float64(cdPerStep*(fw+rw)))
	p.FzF0, p.FzR0 = fzF0, fzR0
	p.Transfer = transferK
	bias := float64(s[BrakeBias]) / 100
	p.BrakeF, p.BrakeR = brakeMax*bias, brakeMax*(1-bias)
	for g, total := range gearTable[s[Gearing]-1] {
		p.Drive[g] = total / wheelR
		p.RPMPerMS[g] = p.Drive[g] * rpmPerRad
	}
	p.DiffK = diffStep * float64(s[Diff]-1)
	p.DiffX = diffGrip * float64(s[Diff]-1)
	p.LatF = latFront0 + float64(latFrontK*float64(s[SuspBalance]-1))
	p.LatK = latK
	p.GripDmg = 1 - float64(suspLoss*d.Susp)
	return p
}
