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
		drive = float64(float64(thr*torque(rpm)) * p.Drive[st.Gear-1])
	}

	// Longitudinal tyre forces (brakes oppose motion), each capped at μ·Fz per
	// axle: wheelspin and lock-up limit drive and brake force.
	sg := sign(st.VX)
	baseMu := float64(float64(mu*p.Mu) * p.GripDmg)
	capF, capR := float64(baseMu*fzF), float64(baseMu*fzR)
	fxF := clamp(-float64(float64(sg*brk)*p.BrakeF), capF)
	fxR := clamp(drive-float64(float64(sg*brk)*p.BrakeR), capR)

	// Lateral: tyre curve, lateral transfer as grip loss, diff lock; the
	// friction circle then scales Fy to what Fx leaves.
	fyF := float64(capF * curve(af/p.AlphaF))
	fyR := float64(capR * curve(ar/p.AlphaR))
	lat := float64(abs(fyF+fyR) * p.LatK)
	kF := max(1-float64(float64(latLoss*p.LatF)*lat)/fzF, 0)
	kR := max(1-float64(float64(latLoss*(1-p.LatF))*lat)/fzR, 0)
	if in.Throttle > diffOn {
		kR = float64(kR * max(1-float64(p.DiffK*in.Throttle), 0))
	}
	capF, capR = float64(capF*kF), float64(capR*kR)
	fyF, fyR = float64(fyF*kF), float64(fyR*kR)
	fyF = circle(fxF, fyF, capF)
	fyR = circle(fxR, fyR, capR)
	if sv < lowSpeed {
		fyF, fyR = float64(fyF*sv), float64(fyR*sv)
		st.R = float64(st.R * yawDamp)
	}

	// Body accelerations.
	drag := float64(p.DragK*math.Sqrt(v2)) + float64(float64(envDrag*mass)*clean(env.Drag, 0, 10))
	fx := fxF + fxR - float64(drag*st.VX) - float64(sg*rollRes)
	ax := fx / mass
	ay := (fyF+fyR)/mass - float64(st.VX*st.R)
	rdot := (float64(cgFront*fyF) - float64(cgRear*fyR)) / yawI

	// Integrate velocities (resistive forces never reverse VX).
	vx := st.VX + float64(ax*DT) + float64(float64(st.VY*st.R)*DT)
	if st.VX > 0 && vx < 0 || st.VX < 0 && vx > 0 && drive == 0 {
		vx = 0
	}
	st.VX = vx
	st.VY += float64(ay * DT)
	st.R += float64(rdot * DT)
	if p.Assists {
		// Yaw rate whose centripetal demand matches the lateral force available
		// this tick (downforce included), with a margin.
		cap := float64(float64(p.Mu*mu)*(fzF+fzR)) * yawCapK / float64(mass*max(st.VX, 5))
		st.R = min(max(st.R, -cap), cap)
	}
	st.AX = ax

	// Heading: rotate (HX, HZ) by θ = R·DT, Taylor sin/cos, renormalise.
	th := float64(st.R * DT)
	t2 := float64(th * th)
	c := 1 - t2/2 + float64(t2*t2)/24
	s := th - float64(t2*th)/6 + float64(float64(float64(t2*t2)*th))/120
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

// torque interpolates the engine table; flat below idle, cut at the limiter.
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
	return torqueNm[i-1] + float64(f*(torqueNm[i]-torqueNm[i-1]))
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

func sign(v float64) float64 {
	switch {
	case v > 0:
		return 1
	case v < 0:
		return -1
	}
	return 0
}

func clamp(v, lim float64) float64 { return min(max(v, -lim), lim) }
