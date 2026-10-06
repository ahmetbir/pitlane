// Package race runs the simulation of a session on top of track and car.
package race

import (
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

const (
	halfWidth  = 1.0 // car half-width (m)
	wallBounce = 0.2 // normal velocity kept, reversed
	wallSlide  = 0.7 // tangential velocity kept
	wallSpin   = 0.5 // yaw rate kept
)

// envFor maps a surface to its grip and drag.
func envFor(s track.Surface) car.Env {
	switch s {
	case track.Asphalt:
		return car.Env{Mu: 1}
	case track.Kerb:
		return car.Env{Mu: 0.9}
	}
	return car.Env{Mu: 0.55, Drag: 0.9}
}

// moveCar steps one car and resolves the barrier; hint is the car's last seg (updated).
// It returns the wall impulse (N·s, 0 = no hit) and the outward wall normal.
func moveCar(st *car.State, p *car.Params, in car.Input, tr *track.Track, hint *int) (wallImpulse float64, n vec) {
	_, lat, _ := tr.Locate(st.X, st.Z, *hint)
	car.Step(st, p, in, envFor(tr.SurfaceAt(lat)))

	n, out := keepInside(st, tr, hint)
	if !out {
		return 0, vec{}
	}
	t := vec{-n.z, n.x}
	v := worldVel(st)
	vn, vt := v.dot(n), v.dot(t)
	if vn > 0 {
		wallImpulse = float64(car.Mass*(1+wallBounce)) * vn
		vn = -wallBounce * vn
	}
	setWorldVel(st, n.scale(vn).add(t.scale(vt*wallSlide)))
	st.R *= wallSpin
	return wallImpulse, n
}

// keepInside moves a car past the barrier limit back onto it (position only) and
// returns the outward wall normal; hint is updated.
func keepInside(st *car.State, tr *track.Track, hint *int) (n vec, out bool) {
	i, lat, s := tr.Locate(st.X, st.Z, *hint)
	*hint = i
	limit := tr.WallLat() - halfWidth
	if math.Abs(lat) <= limit {
		return vec{}, false
	}
	sign := math.Copysign(1, lat)
	st.X, st.Z = tr.Point(s, sign*limit)

	// Outward wall normal from the track frame at s.
	x0, z0 := tr.Point(s, 0)
	x1, z1 := tr.Point(s, 1)
	return vec{sign * (x1 - x0), sign * (z1 - z0)}, true
}
