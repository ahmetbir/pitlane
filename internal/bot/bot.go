// Package bot drives AI cars: it follows the track's racing line with pure-pursuit steering
// and holds a per-segment target speed (curvature-limited, then braking and acceleration
// passes). Bots press only what a human could: throttle, brake and steer in their ranges.
// Everything is deterministic for a given input sequence on one architecture.
package bot

import (
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// Tuning (see the Task 9 report for how these were chosen).
const (
	gravity = 9.81
	vMax    = 95.0 // profile cap (m/s)

	// Speed profile.
	muSim, muArcade = 1.35, 1.6 // μ_eff: grip incl. downforce, for the closed-form corner speed
	brakeMax        = 25.0      // backward pass cap (m/s²)
	brakeUse        = 0.8       // share of the tyres' grip (downforce incl.) the backward pass brakes with
	accel           = 9.0       // forward pass (m/s²)
	minBrakeShare   = 0.1       // squared share of grip the backward pass always brakes with
	dmgWing         = 0.12      // share of target speed a fully lost front downforce costs

	// Steering.
	lookBase, lookPer = 8.0, 0.35 // pure-pursuit look-ahead: base m + s per m/s
	yawGain           = 1.0       // yaw-rate error feedback (× kinematic steer)
	slipUse           = 1.0       // front slip angle limit, × the tyre's peak
	slipVX            = 3.0       // m/s: below this the slip limit is off

	// Pedals.
	thrGain, brkGain = 4.0, 2.0 // m/s of speed error for full throttle / full brake
	coastBand        = 2.0      // m/s over the target before the brakes come on
	holdTorque       = 500.0    // Nm: engine torque assumed for the drag-balancing throttle
	rollRes          = 120.0    // N (car package)
	tractionUse      = 0.9      // share of the rear tyre's remaining force the throttle may ask for
	brakeUseF        = 0.95     // share of each axle's remaining force the brakes may ask for

	// Turning around.
	turnR    = 14.0 // m: turning radius on full lock at walking pace (L/tan 0.3 ≈ 11.6, + margin)
	turnV    = 6.0  // m/s
	turnDone = 0.7  // heading·tangent at which a turn-around is complete
	turnWall = 2.0  // m: the turning circle keeps this far from the wall line

	// Traffic.
	passGap     = 4.0   // m beside the car being passed (a car is 1.9 m wide)
	passMin     = 3.5   // m: with less room than this beside it, follow instead
	maxShift    = 12.0  // m: largest shift off the racing line
	movingAX    = 0.5   // m/s²: a slow car accelerating harder than this is getting going, not standing
	standV      = 1.0   // m/s: a car slower than this is standing (a queue crawling along is followed)
	nudgeV      = 1.5   // m/s: crawl right behind a standing car (a touch does no damage)
	wallClear   = 2.0   // m: round a standing car, the aim stays this far from the wall line
	passCurve   = 0.006 // 1/m: line curvature above which no pass starts
	passBrake   = 1.0   // m/s: over the profile speed by this much, the car is braking: no pass starts
	shiftLook   = 50    // segs (≈100 m) checked for a tighter shifted radius
	shiftDecel  = 8.0   // m/s²: braking planned for it
	passMargin  = 1.0   // m/s: a car ahead this much slower than this car is worth passing
	shiftRate   = 2.0   // m/s: the shift moves at most this fast (4 m in 2 s)
	edgeMargin  = 1.0   // the shifted line stays this far inside the asphalt edge
	followGap   = 6.0   // m: gap kept behind a car in the way
	followK     = 2.0   // 1/s: speed under the car ahead per metre inside followGap
	followDecel = 6.0   // m/s²: braking the follower plans with to arrive at followGap
	overlapLat  = 3.5   // m: lateral distance under which a car is in the way

	// Standing cars.
	maxPasses    = 4    // passes planned at once
	passIn       = 7.0  // m before a standing car the path is beside it (5.4 m bodies + margin)
	passOut      = 7.0  // m after it the path starts back
	passWall     = 1.5  // m: the passing car's side stays this far from the wall, else the other side
	carHalfWidth = 1.0  // m
	planLat      = 3.0  // m/s²: peak sideways acceleration the path's ramps are drawn for
	minRamp      = 20.0 // m
	clearLat     = 2.6  // m: centre-to-centre lateral distance at which it is passed safely
	clearLen     = 6.0  // m: centre gap at which the bodies would meet
	reactT       = 0.2  // s: steering lag allowed for
	swerveLat    = 4.0  // m/s²: sideways acceleration a late swerve is counted with
	stopShort    = 8.0  // m: centre gap a bot that cannot get round stops at
	brakeSimV    = 18.0 // m/s²: braking counted on for it (Sim)
	brakeArcadeV = 22.0 // m/s²: (Arcade)
	boxedGap     = 10.0 // m: a standing car this close ahead and not yet cleared: full lock round it
	boxedCos     = 0.8  // … while heading · tangent is at least this
	boxedV       = 3.0  // m/s: … and the car is this slow
	passSlack    = 0.1  // share of the corner speed given up beside a standing car (grip left to hold the path)

	// The car (car package values the bot drives by).
	wheelbase  = 3.6
	cgFront    = 1.98 // CG → front axle (m)
	cgRear     = 1.62
	steerLock  = 0.30
	arcadeVX   = 60.0 // Arcade steer scaling, compensated by the bot
	peakTorque = 600.0
	dt         = car.DT
)

// Brain is one bot driver on one Profile (a track and a handling). Skill scales target speeds;
// Offset is the current overtaking shift.
type Brain struct {
	Skill  float64 // 0.90..0.98
	Offset float64 // m, left +

	prof   *Profile
	turn   float64 // committed turn-around direction (+1 left, −1 right, 0 none)
	passes [maxPasses]pass
	np     int // passes in use
}

// Other is another car as the race located it this tick: its state, its distance along the
// track and its lateral offset.
type Other struct {
	St     *car.State
	S, Lat float64
}

// pass is a committed move round a standing car: the bot's path leaves the line (plus Offset)
// in before the car, reaches track lat to passIn before it, holds it until passOut after it and
// returns over out.
type pass struct {
	car     *car.State // the standing car, matched by identity while the race reports it
	s, lat  float64    // where it stands
	side    float64    // +1: pass on its left
	to      float64    // track lat the bot passes it at
	in, out float64    // m: ramp lengths before and after
}

// NewBrain maps a seed to a driver on prof: Skill uniform in [0.90, 0.98).
func NewBrain(seed uint64, prof *Profile) Brain {
	u := float64(mix(seed)>>11) / (1 << 53)
	return Brain{Skill: 0.90 + 0.08*u, prof: prof}
}

// Reset forgets the driver's manoeuvres (shift, turn-around, passes); Skill and Profile stay.
func (b *Brain) Reset() { b.Offset, b.turn, b.np = 0, 0, 0 }

// mix is the splitmix64 finaliser.
func mix(z uint64) uint64 {
	z += 0x9e3779b97f4a7c15
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// Drive returns the bot's input for this tick. seg is the car's last seg (Locate hint);
// ahead is the nearest car within 12 m ahead on track and ±4 m lateral (nil = none); stand
// lists the standing cars further ahead that the race reports, wherever they are across the
// track. Only those on the bot's path are gone round.
func (b *Brain) Drive(st *car.State, p *car.Params, seg int, ahead *Other, stand []Other) car.Input {
	prof, tr := b.prof, b.prof.tr
	n := len(tr.Segs)
	ds := tr.Length / float64(n)
	_, lat, s := tr.Locate(st.X, st.Z, seg)
	speed := st.Speed()

	b.planPasses(s, lat, speed, stand)
	vp := b.targetSpeed(prof, s, ds) * prof.damageScale(p)
	vt := vp
	edge := tr.Width/2 - edgeMargin
	target := 0.0
	band := coastBand

	// A moving car close ahead: keep a gap behind it when it is in the way; pass it on its
	// roomier side, passGap beside it, when this car is catching it and the asphalt leaves room.
	// A standing car is the passes' business.
	if ahead != nil && !standing(ahead.St) {
		av := ahead.St.Speed()
		if av < speed-passMargin {
			target = passTarget(tr, s, ahead.Lat, edge)
		}
		if gap := wrap(ahead.S-s, tr.Length); math.Abs(ahead.Lat-lat) < overlapLat {
			// Arrive at followGap at its speed; closer than that, drop back (never below 0).
			vf := max(math.Sqrt(av*av+2*followDecel*max(gap-followGap, 0))-followK*max(followGap-gap, 0), 0)
			if vf < vt {
				vt, band = vf, 0
			}
		}
	}
	if math.Abs(prof.k[int(s/ds)%n]) > passCurve || vp < speed-passBrake {
		// In a corner or a braking zone no pass starts and a shift only shrinks.
		target = clamp(target, min(0, b.Offset), max(0, b.Offset))
	}
	b.Offset += max(min(target-b.Offset, shiftRate*dt), -shiftRate*dt)
	// Round a standing car (and back from one) the path may leave the asphalt.
	if b.np > 0 || math.Abs(lineAt(tr, s)+b.Offset) > edge {
		edge = tr.WallLat() - wallClear
	}
	if vs := b.standSpeed(s, lat, speed); vs < vt {
		vt, band = vs, 0
	}

	// Steering: pure pursuit to the path, look-ahead ∝ speed. Off the path (rejoining from the
	// grass), look further so the way back is gentle.
	look := lookBase + lookPer*speed + math.Abs(lat-b.pathAt(s))
	ls := s + look
	tl := max(min(b.pathAt(ls), edge), -edge)
	tx, tz := tr.Point(ls, tl)
	dx, dz := tx-st.X, tz-st.Z
	fwd := dx*st.HX + dz*st.HZ
	left := -dx*st.HZ + dz*st.HX
	alpha := math.Atan2(left, fwd)
	// The point is behind the car: turn around, slowly, where there is room, until the car
	// points down the track again.
	x0, z0 := tr.Point(s, 0)
	x1, z1 := tr.Point(s+1, 0)
	hd := (x1-x0)*st.HX + (z1-z0)*st.HZ // heading · tangent
	if hd >= turnDone {
		b.turn = 0
	}
	if fwd < 0 || b.turn != 0 {
		return b.turnAround(st, p, tr, s, lat, alpha, speed)
	}
	kappa := 2 * math.Sin(alpha) / look
	// Yaw-rate feedback: steer less (or against) when the car rotates faster than the arc.
	delta := wheelbase*kappa + yawGain*wheelbase*(kappa*max(speed, 5)-st.R)/max(speed, 5)
	// Keep the front slip angle near the tyre's peak: past it, more lock means less grip.
	if st.VX > slipVX {
		th := (st.VY + cgFront*st.R) / st.VX
		lim := slipUse * p.AlphaF
		delta = clamp(delta, th-lim, th+lim)
	}
	steer := delta / steerLock
	if prof.h == car.Arcade {
		steer *= 1 + max(st.VX, 0)/arcadeVX
	}
	steer = clamp(steer, -1, 1)
	// Right behind a standing car with no room to swerve: full lock to the pass side while the
	// car still points down the track (there is no reverse gear: this is the only way round).
	if side := b.boxedIn(s, lat); side != 0 && hd >= boxedCos && speed < boxedV {
		steer = side
	}

	// Throttle and brake from the speed error, within what the surface under the car grips.
	mu := surfaceMu(tr.SurfaceAt(lat))
	in := pedals(st, p, mu, vt-speed, band)
	in.Steer = steer
	return in
}

// passTarget is the shift that puts the car passGap beside a car at lat aLat, on its roomier
// side within ±edge; 0 when that leaves less than passMin.
func passTarget(tr *track.Track, s, aLat, edge float64) float64 {
	side := 1.0
	if aLat > 0 { // less room to its left than to its right
		side = -1
	}
	pl := clamp(aLat+side*passGap, -edge, edge)
	if math.Abs(pl-aLat) < passMin {
		return 0
	}
	return clamp(pl-lineAt(tr, s), -maxShift, maxShift)
}

// standing: c is stopped or nearly (not crawling along in a queue) and not pulling away.
func standing(c *car.State) bool { return c.Speed() < standV && c.AX < movingAX }

// planPasses keeps the passes up to date: a car still reported updates its pass; a pass is
// dropped once the bot is past its return, or when its car got going before the bot began to
// move out; a standing car (not pulling away) on the bot's path, the path's lat at its s within
// overlapLat of its own, gets a pass.
func (b *Brain) planPasses(s, lat, speed float64, stand []Other) {
	tr := b.prof.tr
	L := tr.Length
	lim := tr.WallLat() - carHalfWidth - passWall
	was, dropped := b.pathAt(s), false
	k := 0
	for _, ps := range b.passes[:b.np] {
		seen := false
		for i := range stand {
			if o := &stand[i]; o.St == ps.car && standing(o.St) {
				seen = true
				ps.s, ps.lat = o.S, o.Lat
				ps.to = clamp(o.Lat+ps.side*passGap, -lim, lim)
			}
		}
		if !seen && wrap(s-ps.s, L) <= 0 {
			dropped = true // its car got going (or is gone) before the bot reached it
			continue
		}
		if wrap(s-ps.s, L) > passOut+ps.out {
			continue
		}
		b.passes[k] = ps
		k++
	}
	b.np = k
	if dropped {
		// The path keeps where it is here as a shift, which shrinks back to the line.
		coef := 1.0
		for _, ps := range b.passes[:b.np] {
			coef *= 1 - ps.weight(wrap(s-ps.s, L))
		}
		if coef > 1e-3 {
			b.Offset = clamp(b.Offset+(was-b.pathAt(s))/coef, -maxShift, maxShift)
		}
	}
	for i := range stand {
		o := &stand[i]
		gap := wrap(o.S-s, L)
		if b.np == maxPasses || gap <= 0 || !standing(o.St) || b.passing(o.St) {
			continue
		}
		pl := b.pathAt(o.S)
		if math.Abs(pl-o.Lat) >= overlapLat {
			continue // not on the path
		}
		// The side the path is already on; level with it, the side the car is on, then the roomier.
		side := sign(pl - o.Lat)
		if side == 0 {
			side = sign(lat - o.Lat)
		}
		if side == 0 {
			side = -sign(o.Lat)
		}
		if side == 0 {
			side = 1
		}
		if math.Abs(o.Lat+side*passGap) > lim {
			side = -side
		}
		to := clamp(o.Lat+side*passGap, -lim, lim)
		// Ramp long enough for a gentle sideways move at this speed, starting no nearer than here.
		ramp := max(speed*math.Sqrt(6*math.Abs(to-pl)/planLat), minRamp)
		b.passes[b.np] = pass{car: o.St, s: o.S, lat: o.Lat, side: side, to: to, in: min(passIn+ramp, gap), out: ramp}
		b.np++
	}
}

// passing: c already has a pass.
func (b *Brain) passing(c *car.State) bool {
	for _, ps := range b.passes[:b.np] {
		if ps.car == c {
			return true
		}
	}
	return false
}

// pathAt is the track lat the bot means to be at, at distance s: the racing line plus Offset,
// bent by each pass round its car.
func (b *Brain) pathAt(s float64) float64 {
	tr := b.prof.tr
	l := lineAt(tr, s) + b.Offset
	for _, ps := range b.passes[:b.np] {
		l += ps.weight(wrap(s-ps.s, tr.Length)) * (ps.to - l)
	}
	return l
}

// weight is how far the path at d metres past the car (negative: before it) is moved onto
// the pass lat: 0 → 1 over the ramp in, 1 from passIn before it to passOut after it, 1 → 0
// over the ramp out.
func (ps *pass) weight(d float64) float64 {
	switch {
	case d <= -ps.in || d >= passOut+ps.out:
		return 0
	case d < -passIn:
		return smooth((d + ps.in) / max(ps.in-passIn, 1))
	case d <= passOut:
		return 1
	}
	return 1 - smooth((d-passOut)/ps.out)
}

// standSpeed caps the speed for the passes whose car is still ahead: where the bot cannot get
// clearLat beside the car before it (a swerve at swerveLat, on a circle no tighter than full
// lock), it slows to stop stopShort behind it. Right behind a car it still cannot get round
// it crawls on at nudgeV, steering out: a standing car cannot make room.
func (b *Brain) standSpeed(s, lat, speed float64) float64 {
	tr := b.prof.tr
	aB := brakeSimV
	if b.prof.h == car.Arcade {
		aB = brakeArcadeV
	}
	v := math.Inf(1)
	for _, ps := range b.passes[:b.np] {
		gap := wrap(ps.s-s, tr.Length)
		m := clearLat - ps.side*(lat-ps.lat)
		if gap <= 0 || m <= 0 {
			continue
		}
		vf := 0.0
		if x := gap - clearLen - reactT*speed; x > 0 {
			if rr := (x*x + m*m) / (2 * m); rr >= turnR {
				vf = math.Sqrt(swerveLat * rr)
			}
		}
		vs := math.Sqrt(2 * aB * max(gap-stopShort, 0))
		v = min(v, max(vf, vs, nudgeV))
	}
	return v
}

// passWeight is the largest pass weight at s: how far the path there is bent round a car.
func (b *Brain) passWeight(s float64) float64 {
	w := 0.0
	for _, ps := range b.passes[:b.np] {
		w = max(w, ps.weight(wrap(s-ps.s, b.prof.tr.Length)))
	}
	return w
}

// boxedIn is the side of the pass whose car is less than boxedGap ahead while the bot is not
// yet clearLat beside it; 0 when there is none.
func (b *Brain) boxedIn(s, lat float64) float64 {
	for _, ps := range b.passes[:b.np] {
		gap := wrap(ps.s-s, b.prof.tr.Length)
		if gap > 0 && gap < boxedGap && ps.side*(lat-ps.lat) < clearLat {
			return ps.side
		}
	}
	return 0
}

func smooth(u float64) float64 { return u * u * (3 - 2*u) }

func sign(v float64) float64 {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}

// targetSpeed is the skill-scaled profile speed, lowered where the path (shift and passes)
// puts the car on a tighter radius than the line: over the next shiftLook segs, each seg's
// corner speed on the path, reachable from here at shiftDecel.
func (b *Brain) targetSpeed(prof *Profile, s, ds float64) float64 {
	n := len(prof.v)
	i := int(s/ds) % n
	vt := b.Skill * prof.v[i]
	if b.Offset == 0 && b.np == 0 {
		return vt
	}
	for j := 0; j < shiftLook; j++ {
		m := (i + j) % n
		off, slack := b.Offset, 1.0
		if b.np > 0 {
			sm := float64(i+j) * ds
			pl := b.pathAt(sm)
			off = pl - lineAt(prof.tr, sm)
			// Grip given up beside the car, and off the asphalt the surface's.
			slack = (1 - passSlack*b.passWeight(sm)) * math.Sqrt(surfaceMu(prof.tr.SurfaceAt(math.Abs(pl)+carHalfWidth)))
		}
		f := (1 - prof.k[m]*off) * slack * slack // radius ratio path/line (toward the inside: < 1), × grip
		if f >= 1 {
			continue
		}
		vj := b.Skill * prof.v[m] * math.Sqrt(max(f, 0.3))
		vt = min(vt, math.Sqrt(vj*vj+2*shiftDecel*float64(j)*ds))
	}
	return vt
}

// pedals turns a speed error (m/s) into throttle or brake. Around zero error the car holds
// a part throttle that balances drag, so it never coasts through a corner (lifting
// mid-corner unloads the rear); braking starts below −band.
func pedals(st *car.State, p *car.Params, mu, e, band float64) car.Input {
	g := min(max(st.Gear, 1), 8) - 1
	v2 := st.VX*st.VX + st.VY*st.VY
	hold := math.Sqrt((p.DragK*v2 + rollRes) / (holdTorque * p.Drive[g]))
	tc := tractionCap(st, p, mu)
	if e > -band {
		return car.Input{Throttle: clamp(min(hold+max(e, 0)/thrGain, tc), 0, 1)}
	}
	return car.Input{Brake: min(clamp(-(e+band)/brkGain, 0, 1), brakeCap(st, p, mu))}
}

// turnAround steers a car facing away from its target on full lock (there is no reverse
// gear), committed to the side whose turning circle fits between the walls, the side toward
// the target first; with neither fitting it first drifts toward the nearer wall to make room.
func (b *Brain) turnAround(st *car.State, p *car.Params, tr *track.Track, s, lat, alpha, speed float64) car.Input {
	x0, z0 := tr.Point(s, 0)
	x1, z1 := tr.Point(s, 1)
	side := (-st.HZ)*(x1-x0) + st.HX*(z1-z0) // + when the car's left is the track's left
	lim := tr.WallLat() - turnWall
	fits := func(dir float64) bool { return math.Abs(lat+dir*side*turnR)+turnR <= lim }
	if b.turn == 0 {
		switch dir := math.Copysign(1, alpha); {
		case fits(dir):
			b.turn = dir
		case fits(-dir):
			b.turn = -dir
		}
	}
	steer := b.turn
	if steer == 0 {
		steer = 0.5 * math.Copysign(1, lat*side) // toward the nearer wall
	}
	in := pedals(st, p, surfaceMu(tr.SurfaceAt(lat)), turnV-speed, coastBand)
	in.Steer = steer
	return in
}

// tractionCap is the throttle at which peak drive force uses only what the rear tyres have
// left after the lateral force the car is pulling now (a driver feeling the rear go light).
func tractionCap(st *car.State, p *car.Params, mu float64) float64 {
	v2 := st.VX*st.VX + st.VY*st.VY
	capR := mu * p.Mu * (p.FzR0 + p.AeroR*v2)
	// Rear share of the lateral force: m·ay·a/L, ay = VX·R.
	fy := car.Mass * math.Abs(st.VX*st.R) * cgFront / wheelbase
	room := capR*capR - fy*fy
	if room <= 0 {
		return 0
	}
	g := min(max(st.Gear, 1), 8) - 1
	fx := tractionUse * math.Sqrt(room)
	return clamp(math.Sqrt(fx/(peakTorque*p.Drive[g])), 0, 1)
}

// brakeCap is the pedal at which each axle's brakes use only what its tyres have left after
// the cornering force: without ABS a locked front cannot steer, and an over-braked rear
// lets go (Sim spins).
func brakeCap(st *car.State, p *car.Params, mu float64) float64 {
	v2 := st.VX*st.VX + st.VY*st.VY
	tr := p.Transfer * st.AX
	ay := car.Mass * math.Abs(st.VX*st.R) / wheelbase
	capF := mu * p.Mu * max(p.FzF0+p.AeroF*v2-tr, 0.1*p.FzF0)
	capR := mu * p.Mu * max(p.FzR0+p.AeroR*v2+tr, 0.1*p.FzR0)
	f := leftover(capF, ay*cgRear) / max(p.BrakeF, 1)
	r := leftover(capR, ay*cgFront) / max(p.BrakeR, 1)
	return clamp(brakeUseF*min(f, r), 0, 1)
}

// leftover is the longitudinal force a tyre of capacity c has left while pulling fy sideways.
func leftover(c, fy float64) float64 { return math.Sqrt(max(c*c-fy*fy, 0)) }

// surfaceMu is the grip of a surface as the race applies it (asphalt, kerb, grass).
func surfaceMu(s track.Surface) float64 {
	switch s {
	case track.Asphalt:
		return 1
	case track.Kerb:
		return 0.9
	}
	return 0.55
}

// lineAt interpolates the racing-line offset at distance s.
func lineAt(tr *track.Track, s float64) float64 {
	n := len(tr.Segs)
	u := s / (tr.Length / float64(n))
	fi := math.Floor(u)
	f := u - fi
	i := ((int(fi) % n) + n) % n
	return tr.Line[i] + (tr.Line[(i+1)%n]-tr.Line[i])*f
}

// wrap maps d into (−L/2, L/2].
func wrap(d, L float64) float64 {
	d = math.Mod(d, L)
	if d > L/2 {
		d -= L
	} else if d <= -L/2 {
		d += L
	}
	return d
}

func clamp(v, lo, hi float64) float64 { return min(max(v, lo), hi) }

// Profile is a racing line's target speed and curvature per seg for one track and handling,
// and the braking model the speeds were built with. Read-only once built: share it between
// the brains of a race.
type Profile struct {
	tr       *track.Track
	h        car.Handling
	v, k     []float64
	mu, aero float64 // handling grip; downforce per v² per kg
	aeroF    float64 // undamaged front downforce per v² (N·s²/m²)
}

// damageScale slows a damaged car: the corner speed goes with the square root of the grip
// suspension damage leaves, and a lost front wing costs up to dmgWing of it.
func (pr *Profile) damageScale(p *car.Params) float64 {
	return math.Sqrt(p.GripDmg) * (1 - dmgWing*(1-min(p.AeroF/pr.aeroF, 1)))
}

// brakeDecel is the deceleration the profile plans at speed v on a path of curvature k: a share
// of the tyres' grip (downforce incl.), less what the corner's lateral demand takes (friction
// circle), never below a minimum share.
func (pr *Profile) brakeDecel(v, k float64) float64 {
	grip := brakeUse * pr.mu * (gravity + pr.aero*v*v)
	ay := v * v * math.Abs(k)
	return min(brakeMax, math.Sqrt(max(grip*grip-ay*ay, minBrakeShare*grip*grip)))
}

// Speed is the target speed (m/s) at seg i, before skill.
func (pr *Profile) Speed(i int) float64 { return pr.v[i] }

// Setup is the bots' car setup: the default with traction control at level 3
// (Arcade acts as level 3 whatever the setting) and ABS at its default.
func Setup() car.Setup {
	s := car.DefaultSetup()
	s[car.TC] = 3
	return s
}

// NewProfile builds the speed profile of tr's racing line for handling h: the closed-form corner
// speed, then a braking (backward) and an acceleration (forward) pass.
func NewProfile(tr *track.Track, h car.Handling) *Profile {
	mu := muArcade
	if h == car.Sim {
		mu = muSim
	}
	k := lineCurvature(tr)
	n := len(k)
	ds := tr.Length / float64(n)
	v := make([]float64, n)
	for i, ki := range k {
		v[i] = min(vMax, math.Sqrt(mu*gravity/max(math.Abs(ki), 1e-4)))
	}
	cp := car.NewParams(h, car.DefaultSetup(), car.Damage{})
	pr := &Profile{tr: tr, h: h, v: v, k: k, mu: cp.Mu, aero: (cp.AeroF + cp.AeroR) / car.Mass, aeroF: cp.AeroF}
	// Braking; two laps of each pass settle the wrap-around.
	for j := 2*n - 1; j >= 0; j-- {
		i := j % n
		nv := v[(i+1)%n]
		v[i] = min(v[i], math.Sqrt(nv*nv+2*pr.brakeDecel(nv, k[i])*ds))
	}
	for j := 0; j < 2*n; j++ {
		i := j % n
		pv := v[(i+n-1)%n]
		v[i] = min(v[i], math.Sqrt(pv*pv+2*accel*ds))
	}
	return pr
}

// lineCurvature is the signed curvature of the racing line per seg, from the circle through
// the line points two segs either side.
func lineCurvature(tr *track.Track) []float64 {
	n := len(tr.Segs)
	px, pz := make([]float64, n), make([]float64, n)
	for i, g := range tr.Segs {
		px[i], pz[i] = g.X+tr.Line[i]*g.NX, g.Z+tr.Line[i]*g.NZ
	}
	k := make([]float64, n)
	for i := range k {
		a, c := (i+n-2)%n, (i+2)%n
		ax, az := px[i]-px[a], pz[i]-pz[a]
		bx, bz := px[c]-px[i], pz[c]-pz[i]
		cx, cz := px[c]-px[a], pz[c]-pz[a]
		cross := ax*bz - az*bx
		k[i] = 2 * cross / (math.Hypot(ax, az) * math.Hypot(bx, bz) * math.Hypot(cx, cz))
	}
	return k
}
