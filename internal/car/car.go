// Package car is Pitlane's vehicle model: a dynamic bicycle model stepped at a
// fixed 60 Hz. Step uses only + − × ÷ sqrt and comparisons, and materialises
// every product that feeds a sum (float64(a*b)) so Go cannot fuse it into an
// FMA; the TS port in client/src/car replays Go-written vectors.
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

// Setup is the garage setup, indexed by FrontWing … SuspBalance.
type Setup [6]int

const (
	FrontWing = iota
	RearWing
	BrakeBias
	Gearing
	Diff
	SuspBalance
)

var setupMin, setupMax = Setup{1, 1, 50, 1, 1, 1}, Setup{11, 11, 70, 5, 10, 9}

func DefaultSetup() Setup { return Setup{6, 6, 58, 3, 5, 5} }

func (s Setup) Clamp() Setup {
	for i := range s {
		s[i] = min(max(s[i], setupMin[i]), setupMax[i])
	}
	return s
}

// Damage is 0 (intact) .. 1 (broken) per part.
type Damage struct{ FrontWing, RearWing, Susp float64 }

// Input is one tick of driver input: Throttle 0..1, Brake 0..1, Steer -1..1 (left +).
type Input struct{ Throttle, Brake, Steer float64 }

func (in Input) Clean() Input {
	return Input{clean(in.Throttle, 0, 1), clean(in.Brake, 0, 1), clean(in.Steer, -1, 1)}
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
// so it is part of the replayable state.
type State struct {
	X, Z, H   float64 // m, m, rad
	HX, HZ    float64 // unit heading; body left is (−HZ, HX)
	VX, VY, R float64 // body forward, body left (m/s), yaw rate (rad/s, CCW +)
	Delta     float64 // front wheel angle (rad, left +)
	RPM       float64
	Gear      int // 1..8
	AX        float64
	Dmg       Damage
}

func (st State) Speed() float64 { return math.Sqrt(st.VX*st.VX + st.VY*st.VY) }

// Mass is the car mass (kg), exported for collision impulses.
const Mass = 798.0

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
	clRearBase = 1.5  // rear C_L at RearWing 1 (tuned from 1.2 for Sim stability)
	simAlphaR  = 0.11 // Sim rear αpk
	arcAlphaR  = 0.15 // Arcade rear αpk
	brakeMax   = 30e3
	rollRes    = 120.0
	steerLock  = 0.30
	latLoss    = 0.12 // grip loss per unit of lateral transfer / axle load
	envDrag    = 0.2  // Env.Drag → linear drag, (N per m/s) per kg
	suspLoss   = 0.15 // grip loss at Dmg.Susp = 1
	minLoad    = 0.1  // axle load floor, × static load
	lowSpeed   = 1.0  // below this |VX| lateral force blends to 0
	slipCap    = 0.6  // slip angle clamp (rad)
	slipVX     = 3.0  // slip denominator floor (m/s)
	yawDamp    = 0.9  // low-speed yaw damping per step
	yawCapK    = 1.15 // Arcade yaw cap margin over available lateral grip
	arcadeVX   = 60.0 // Arcade steer scaling speed
	tcCut      = 0.5  // Arcade TC throttle factor
	absCut     = 0.6  // Arcade ABS brake factor
	tcSlip     = 0.9  // TC engages above this fraction of αpk (rear)
	diffOn     = 0.3  // diff lock acts above this throttle
	diffStep   = 0.04 // rear capacity loss per diff step × throttle
	latFront0  = 0.3  // front share of lateral transfer at SuspBalance 1
	latFrontK  = 0.05 // … per SuspBalance step
)

var (
	// Gearing sets the gearbox spacing: gear 1's overall ratio is fixed, gear 8's
	// comes from the setting, gears 2..7 are geometric between them. Long gearing
	// means wider steps, so a bigger rpm drop after each upshift.
	firstRatio = 3.0 * 5.39
	topRatio   = [5]float64{6.13, 5.75, 5.39, 5.05, 4.75}
	torqueRPM  = [5]float64{4000, 7000, 10500, 12500, 13500}
	torqueNm   = [5]float64{430, 560, 600, 540, 470}
)

// Params holds every constant Step needs, derived once per car.
type Params struct {
	Mu             float64 // handling grip
	AlphaF, AlphaR float64 // peak slip (rad)
	SteerRate      float64 // rad/s
	Assists        bool    // Arcade: steer scaling, TC, ABS, yaw cap

	AeroF, AeroR float64 // downforce per v² (N·s²/m²)
	DragK        float64 // aero drag per v² (N·s²/m²)
	FzF0, FzR0   float64 // static axle loads (N)
	Transfer     float64 // m·hcg/L
	BrakeF       float64 // front brake force at Brake 1 (N)
	BrakeR       float64
	Drive        [8]float64 // wheel force per Nm of engine torque, per gear
	RPMPerMS     [8]float64 // engine rpm per m/s, per gear
	DiffK        float64    // 0.04·(Diff−1)
	LatF         float64    // front share of lateral transfer
	LatK         float64    // hcg/track width
	GripDmg      float64    // suspension damage grip factor
}

func NewParams(h Handling, s Setup, d Damage) Params {
	s = s.Clamp()
	d = Damage{clean(d.FrontWing, 0, 1), clean(d.RearWing, 0, 1), clean(d.Susp, 0, 1)}
	p := Params{Mu: 1.00, AlphaF: 0.10, AlphaR: simAlphaR, SteerRate: 2.5}
	if h == Arcade {
		p = Params{Mu: 1.25, AlphaF: 0.14, AlphaR: arcAlphaR, SteerRate: 4.0, Assists: true}
	}
	q := 0.5 * rho * refArea
	clF := 0.9 + 0.22*float64(s[FrontWing]-1)*(1-0.7*d.FrontWing)
	clR := clRearBase + 0.26*float64(s[RearWing]-1)*(1-0.7*d.RearWing)
	p.AeroF, p.AeroR = q*clF, q*clR
	p.DragK = q * (cdBase + cdPerStep*float64(s[FrontWing]-1+s[RearWing]-1))
	p.FzF0 = mass * gravity * cgRear / wheelbase
	p.FzR0 = mass * gravity * cgFront / wheelbase
	p.Transfer = mass * cgHeight / wheelbase
	bias := float64(s[BrakeBias]) / 100
	p.BrakeF, p.BrakeR = brakeMax*bias, brakeMax*(1-bias)
	step := math.Pow(topRatio[s[Gearing]-1]/firstRatio, 1.0/7)
	for g := range p.Drive {
		total := firstRatio * math.Pow(step, float64(g))
		p.Drive[g] = total / wheelR
		p.RPMPerMS[g] = total / wheelR * 60 / (2 * math.Pi)
	}
	p.DiffK = diffStep * float64(s[Diff]-1)
	p.LatF = latFront0 + latFrontK*float64(s[SuspBalance]-1)
	p.LatK = cgHeight / trackW
	p.GripDmg = 1 - suspLoss*d.Susp
	return p
}
