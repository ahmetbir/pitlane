// Package track defines circuits as closed, arc-length-sampled splines.
//
// Conventions (the race, bots and the TypeScript port depend on them): x is right, z is
// "forward" on a flat plane; heading H is measured from +X counter-clockwise; the unit left
// normal of tangent (TX,TZ) is (-TZ, TX); lateral offsets are positive to the left; curvature
// K is positive when the track turns left (counter-clockwise). Everything is deterministic and
// only construction uses transcendental functions.
//
// Handedness: +Z is +X rotated 90 degrees counter-clockwise in this 2D frame (left of a car
// heading +X); a Y-up Three.js client maps track z to -Z to keep it CCW seen from above.
//
// Queries (frame, Point, Locate) use only + - * / sqrt, with every product
// materialised by float64() so arm64 cannot fuse it; they are bit-portable.
//
// Kiyi returns a shared, read-only *Track: never mutate its slices. Locate returns i, the nearest
// seg (callers keep it as the next hint), and s, the refined distance along the track.
package track

import (
	"math"
	"sync"
)

type Surface uint8

const (
	Asphalt Surface = iota
	Kerb
	Grass
	Wall
)

// Seg is one 2 m sample: centre, unit tangent, unit left normal, distance from start, signed curvature.
type Seg struct{ X, Z, TX, TZ, NX, NZ, S, K float64 }

// Pose is a position with heading (0 = +X, CCW positive).
type Pose struct{ X, Z, H float64 }

type Track struct {
	ID      string
	Width   float64 // asphalt width
	Kerb    float64 // kerb width beyond each edge
	Runoff  float64 // grass beyond the kerb, then the wall
	Length  float64
	Segs    []Seg // closed: last connects to first
	Sectors [3]float64
	Grid    [10]Pose
	Line    []float64 // racing-line lateral offset per seg

	LineSweeps int // relaxation sweeps the racing line needed (diagnostic)
}

var (
	kiyiOnce sync.Once
	kiyi     *Track
)

// Kiyi returns the cached circuit.
func Kiyi() *Track {
	kiyiOnce.Do(func() { kiyi = buildKiyi() })
	return kiyi
}

func (t *Track) ds() float64 { return t.Length / float64(len(t.Segs)) }

// WallLat is the lateral distance at which the wall starts.
func (t *Track) WallLat() float64 { return t.Width/2 + t.Kerb + t.Runoff }

// SurfaceAt classifies a lateral offset.
func (t *Track) SurfaceAt(lat float64) Surface {
	a := math.Abs(lat)
	switch {
	case a <= t.Width/2:
		return Asphalt
	case a <= t.Width/2+t.Kerb:
		return Kerb
	case a <= t.WallLat():
		return Grass
	}
	return Wall
}

// frame returns the interpolated centre, tangent and normal at continuous index u.
func (t *Track) frame(u float64) (x, z, tx, tz, nx, nz float64) {
	n := len(t.Segs)
	fi := math.Floor(u)
	f := u - fi
	i := ((int(fi) % n) + n) % n
	a, b := &t.Segs[i], &t.Segs[(i+1)%n]
	x, z = a.X+float64((b.X-a.X)*f), a.Z+float64((b.Z-a.Z)*f)
	tx, tz = a.TX+float64((b.TX-a.TX)*f), a.TZ+float64((b.TZ-a.TZ)*f)
	l := math.Sqrt(float64(tx*tx) + float64(tz*tz))
	tx, tz = tx/l, tz/l
	return x, z, tx, tz, -tz, tx
}

// Point is the inverse of Locate: world position at distance s along the track, lat to the left.
func (t *Track) Point(s, lat float64) (x, z float64) {
	x, z, _, _, nx, nz := t.frame(s / t.ds())
	return x + float64(lat*nx), z + float64(lat*nz)
}

// Locate finds the nearest seg to (x, z). With hint >= 0 only segs within ±40 of hint (cyclic)
// are searched; hint < 0 searches all. lat is the signed offset (left +), s the distance along.
func (t *Track) Locate(x, z float64, hint int) (i int, lat, s float64) {
	n := len(t.Segs)
	best, bd := 0, math.Inf(1)
	try := func(k int) {
		dx, dz := x-t.Segs[k].X, z-t.Segs[k].Z
		if d := float64(dx*dx) + float64(dz*dz); d < bd {
			best, bd = k, d
		}
	}
	if hint < 0 {
		for k := 0; k < n; k++ {
			try(k)
		}
	} else {
		for o := -40; o <= 40; o++ {
			try((((hint + o) % n) + n) % n)
		}
		// A stale hint finds only a distant or edge-of-window seg: search everything.
		if w := t.WallLat(); bd > w*w || edgeOffset(best, hint, n) {
			bd = math.Inf(1)
			for k := 0; k < n; k++ {
				try(k)
			}
		}
	}
	u := float64(best)
	for it := 0; it < 8; it++ {
		cx, cz, tx, tz, _, _ := t.frame(u)
		u += (float64((x-cx)*tx) + float64((z-cz)*tz)) / t.ds()
	}
	cx, cz, _, _, nx, nz := t.frame(u)
	lat = float64((x-cx)*nx) + float64((z-cz)*nz)
	s = math.Mod(u*t.ds(), t.Length)
	if s < 0 {
		s += t.Length
	}
	return best, lat, s
}

// edgeOffset reports whether best sits on the edge of the ±40 window around hint.
func edgeOffset(best, hint, n int) bool {
	d := ((best-hint)%n + n) % n
	return d == 40 || d == n-40
}
