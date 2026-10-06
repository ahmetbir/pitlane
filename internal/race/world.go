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
// It returns the wall impulse (N·s, 0 = no hit).
func moveCar(st *car.State, p *car.Params, in car.Input, tr *track.Track, hint *int) (wallImpulse float64) {
	_, lat, _ := tr.Locate(st.X, st.Z, *hint)
	car.Step(st, p, in, envFor(tr.SurfaceAt(lat)))

	i, lat, s := tr.Locate(st.X, st.Z, *hint)
	*hint = i
	limit := tr.WallLat() - halfWidth
	if math.Abs(lat) <= limit {
		return 0
	}
	sign := math.Copysign(1, lat)
	st.X, st.Z = tr.Point(s, sign*limit)

	// Outward wall normal from the track frame at s.
	x0, z0 := tr.Point(s, 0)
	x1, z1 := tr.Point(s, 1)
	nx, nz := sign*(x1-x0), sign*(z1-z0)
	tx, tz := -nz, nx

	vx := st.VX*st.HX - st.VY*st.HZ
	vz := st.VX*st.HZ + st.VY*st.HX
	vn := vx*nx + vz*nz
	vt := vx*tx + vz*tz
	if vn > 0 {
		wallImpulse = car.Mass * (1 + wallBounce) * vn
		vn = -wallBounce * vn
	}
	vt *= wallSlide
	vx = vn*nx + vt*tx
	vz = vn*nz + vt*tz
	st.VX = vx*st.HX + vz*st.HZ
	st.VY = -vx*st.HZ + vz*st.HX
	st.R *= wallSpin
	return wallImpulse
}
