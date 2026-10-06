package car

import "math"

// Step advances st by DT. Only + − × ÷ sqrt and comparisons; every product
// that feeds a sum is materialised with float64() so it is never fused.
func Step(st *State, p *Params, in Input, env Env) {
	in = in.Clean()
	mu := clean(env.Mu, 0, 2)
	if st.Gear < 1 || st.Gear > 8 {
		st.Gear = 1
	}
	if n := float64(st.HX*st.HX) + float64(st.HZ*st.HZ); !(n > 0.25 && n < 4) {
		st.HX, st.HZ = 1, 0
	}

	// Steering: rate-limited toward the (Arcade: speed-scaled) target.
	target := float64(in.Steer * steerLock)
	if p.Assists {
		target = target / (1 + max(st.VX, 0)/arcadeVX)
	}
	step := float64(p.SteerRate * DT)
	st.Delta += min(max(target-st.Delta, -step), step)

	// Slip angles (small-angle form).
	den := max(abs(st.VX), slipVX)
	af := clamp(st.Delta-(st.VY+float64(cgFront*st.R))/den, slipCap)
	ar := clamp(-(st.VY-float64(cgRear*st.R))/den, slipCap)

	// Assists.
	thr, brk := in.Throttle, in.Brake
	if p.Assists {
		if abs(ar) > tcSlip*p.AlphaR {
			thr = float64(thr * tcCut)
		}
		if abs(af) > p.AlphaF {
			brk = float64(brk * absCut)
		}
	}

	// Normal loads: static + downforce ∓ longitudinal transfer.
	v2 := float64(st.VX*st.VX) + float64(st.VY*st.VY)
	spd := math.Sqrt(v2)
	tr := float64(p.Transfer * st.AX)
	fzF := max(p.FzF0+float64(p.AeroF*v2)-tr, float64(minLoad*p.FzF0))
	fzR := max(p.FzR0+float64(p.AeroR*v2)+tr, float64(minLoad*p.FzR0))

	// Engine and automatic gearbox.
	sv := abs(st.VX)
	rpm := sv * p.RPMPerMS[st.Gear-1]
	if rpm > shiftUp && st.Gear < 8 {
		st.Gear++
	} else if rpm < shiftDown && st.Gear > 1 && sv*p.RPMPerMS[st.Gear-2] < shiftUp {
		st.Gear--
	}
	rpm = max(sv*p.RPMPerMS[st.Gear-1], idleRPM)
	st.RPM = rpm
	drive := 0.0
	if st.VX >= 0 && thr > 0 {
		// Pedal map: torque × throttle², so part throttle is gentle.
		drive = float64(float64(float64(thr*thr)*torque(rpm)) * p.Drive[st.Gear-1])
	}

	// Lateral slip forces, then lateral transfer as grip loss on each axle.
	baseMu := float64(float64(mu*p.Mu) * p.GripDmg)
	capF, capR := float64(baseMu*fzF), float64(baseMu*fzR)
	fyF := float64(capF * curve(af/p.AlphaF))
	fyR := float64(capR * curve(ar/p.AlphaR))
	lat := float64(abs(fyF+fyR) * p.LatK)
	kF := max(1-float64(float64(latLoss*p.LatF)*lat)/fzF, 0)
	kR := max(1-float64(float64(latLoss*(1-p.LatF))*lat)/fzR, 0)
	capF, capR = float64(capF*kF), float64(capR*kR)
	fyF, fyR = float64(fyF*kF), float64(fyR*kR)
	capX := capR // rear longitudinal capacity
	if in.Throttle > diffOn {
		// Diff lock: more traction under power, less rear lateral capacity.
		kd := max(1-float64(p.DiffK*in.Throttle), 0)
		capX = float64(capR * (1 + p.DiffX))
		capR, fyR = float64(capR*kd), float64(fyR*kd)
	}
	if spd < lowSpeed {
		fyF, fyR = float64(fyF*spd), float64(fyR*spd)
		st.R = float64(st.R * yawDamp)
	}

	// Brakes and rolling resistance oppose the full velocity (a spun car
	// brakes sideways too); brake and drive force are capped at the axle's
	// reduced μ·Fz (rear: longitudinal capacity, incl. the diff gain). The friction circle then scales Fy to
	// what Fx leaves.
	ux, uy := 0.0, 0.0
	if spd > 0 {
		ux, uy = st.VX/spd, st.VY/spd
	}
	bF := min(float64(brk*p.BrakeF), capF)
	bR := min(float64(brk*p.BrakeR), capX)
	fxF := -float64(ux * bF)
	fxR := clamp(drive-float64(ux*bR), capX)
	fyF = circle(fxF, fyF-float64(uy*bF), capF)
	fyR = circle(fxR, fyR-float64(uy*bR), capR)

	// Body accelerations (force part only).
	drag := float64(p.DragK*spd) + float64(envDragM*clean(env.Drag, 0, 10))
	fx := fxF + fxR - float64(drag*st.VX) - float64(ux*rollRes)
	fy := fyF + fyR - float64(drag*st.VY) - float64(uy*rollRes)
	ax := fx / mass
	ay := fy / mass
	rdot := (float64(cgFront*fyF) - float64(cgRear*fyR)) / yawI

	// Integrate the force part. It never reverses VX (no reverse gear; brakes
	// stop, they do not push back).
	vx := st.VX + float64(ax*DT)
	if st.VX > 0 && vx < 0 || st.VX < 0 && vx > 0 && drive == 0 {
		vx = 0
	}
	vy := st.VY + float64(ay*DT)
	st.R += float64(rdot * DT)
	if p.Assists {
		// Yaw rate whose centripetal demand matches the lateral force available
		// this tick (downforce included), with a margin.
		cap := float64(float64(p.Mu*mu)*(fzF+fzR)) * yawCapK / float64(mass*max(vx, 5))
		st.R = min(max(st.R, -cap), cap)
	}
	// Brakes and rolling resistance hold a car that they can stop this tick.
	if drive == 0 && float64((bF+bR+rollRes)*DT) >= float64(mass*spd) {
		vx, vy, st.R, ax = 0, 0, 0, 0
	}
	st.AX = ax

	// The body turns by θ = R·DT: rotate (HX, HZ) by +θ and the body-frame
	// velocity by −θ (the VY·R and −VX·R terms, applied as an exact rotation so
	// a spinning car gains no speed). Taylor sin/cos, heading renormalised.
	th := float64(st.R * DT)
	t2 := float64(th * th)
	c := 1 - t2/2 + float64(t2*t2)/24
	s := th - float64(t2*th)/6 + float64(float64(float64(t2*t2)*th))/120
	st.VX = float64(vx*c) + float64(vy*s)
	st.VY = float64(vy*c) - float64(vx*s)
	hx := float64(st.HX*c) - float64(st.HZ*s)
	hz := float64(st.HX*s) + float64(st.HZ*c)
	n := math.Sqrt(float64(hx*hx) + float64(hz*hz))
	st.HX, st.HZ = hx/n, hz/n
	st.H += th

	// Position: world velocity = VX·heading + VY·left.
	wx := float64(st.VX*st.HX) - float64(st.VY*st.HZ)
	wz := float64(st.VX*st.HZ) + float64(st.VY*st.HX)
	st.X += float64(wx * DT)
	st.Z += float64(wz * DT)
}

// torque interpolates the engine table: flat below idle, tapering linearly to
// 0 between taperRPM and limitRPM (no on/off limiter jitter).
func torque(rpm float64) float64 {
	if rpm >= limitRPM {
		return 0
	}
	if rpm <= torqueRPM[0] {
		return torqueNm[0]
	}
	i := 1
	for rpm > torqueRPM[i] {
		i++
	}
	f := (rpm - torqueRPM[i-1]) / (torqueRPM[i] - torqueRPM[i-1])
	t := torqueNm[i-1] + float64(f*(torqueNm[i]-torqueNm[i-1]))
	if rpm > taperRPM {
		t = t * (limitRPM - rpm) / (limitRPM - taperRPM)
	}
	return t
}

// curve is the rational tyre curve 2s/(1+s²): linear, peak 1 at s=1, falls off.
func curve(s float64) float64 { return 2 * s / (1 + float64(s*s)) }

// circle scales fy so that fx²+fy² ≤ cap².
func circle(fx, fy, cap float64) float64 {
	c2, x2 := float64(cap*cap), float64(fx*fx)
	if x2+float64(fy*fy) <= c2 {
		return fy
	}
	rem := math.Sqrt(max(c2-x2, 0))
	return clamp(fy, rem)
}

func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func clamp(v, lim float64) float64 { return min(max(v, -lim), lim) }
