package track

import (
	"math"
	"testing"
)

// wrap maps d into (-L/2, L/2].
func wrap(d, l float64) float64 {
	d = math.Mod(d, l)
	if d > l/2 {
		d -= l
	} else if d <= -l/2 {
		d += l
	}
	return d
}

func TestKiyiShape(t *testing.T) {
	tr := Kiyi()
	if tr.Length < 3600 || tr.Length > 4600 {
		t.Fatalf("length %.0f", tr.Length)
	}
	for i, s := range tr.Segs {
		if l := s.TX*s.TX + s.TZ*s.TZ; math.Abs(l-1) > 1e-9 {
			t.Fatalf("seg %d tangent %v", i, l)
		}
		if d := s.TX*s.NX + s.TZ*s.NZ; math.Abs(d) > 1e-9 {
			t.Fatalf("seg %d normal not orthogonal", i)
		}
	}
}

func TestLocateRoundTrip(t *testing.T) {
	tr := Kiyi()
	for _, s := range []float64{0, 1, 333.3, tr.Length / 2, tr.Length - 1} {
		for _, lat := range []float64{-6, 0, 6.9} {
			x, z := tr.Point(s, lat)
			_, gl, gs := tr.Locate(x, z, -1)
			if math.Abs(gl-lat) > 0.05 || math.Abs(wrap(gs-s, tr.Length)) > 0.05 {
				t.Fatalf("s %v lat %v → %v %v", s, lat, gs, gl)
			}
		}
	}
}

func TestLocateHintWindowAndWrap(t *testing.T) {
	tr := Kiyi()
	n := len(tr.Segs)
	for _, s := range []float64{1, tr.Length - 1, 500} {
		x, z := tr.Point(s, 2)
		hint := (int(s/2) + 25) % n
		_, gl, gs := tr.Locate(x, z, hint)
		if math.Abs(gl-2) > 0.05 || math.Abs(wrap(gs-s, tr.Length)) > 0.05 {
			t.Fatalf("hinted s %v → %v %v", s, gs, gl)
		}
	}
}

func TestSurfaceAt(t *testing.T) {
	tr := Kiyi()
	cases := map[float64]Surface{0: Asphalt, -7: Asphalt, 7.5: Kerb, -8: Kerb, 10: Grass, -20: Grass, 21: Wall}
	for lat, want := range cases {
		if got := tr.SurfaceAt(lat); got != want {
			t.Errorf("lat %v: got %v want %v", lat, got, want)
		}
	}
	if tr.WallLat() != 20 {
		t.Errorf("WallLat %v", tr.WallLat())
	}
}

// Pairs of segs at least minSep apart along s must be at least 2*WallLat+4 apart in space.
// minSepAlongS: segs closer than this along s are one stretch of road (the brief's 40 m is below
// the 44 m required spacing, so it fails on any straight); the closest legitimate pair is 48 m.
const minSepAlongS = 60.0

func TestTrackDoesNotSelfIntersect(t *testing.T) {
	tr := Kiyi()
	n := len(tr.Segs)
	need := 2*tr.WallLat() + 4
	sepSegs := int(minSepAlongS / (tr.Length / float64(n)))
	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			d := j - i
			if n-d < d {
				d = n - d
			}
			if d < sepSegs {
				continue
			}
			dx, dz := tr.Segs[i].X-tr.Segs[j].X, tr.Segs[i].Z-tr.Segs[j].Z
			if dist := math.Hypot(dx, dz); dist < need {
				t.Fatalf("segs %d and %d are %.1f m apart (need %.1f)", i, j, dist, need)
			}
		}
	}
}

func TestGridBehindLineOnTrack(t *testing.T) {
	tr := Kiyi()
	for k, p := range tr.Grid {
		i, lat, s := tr.Locate(p.X, p.Z, -1)
		if math.Abs(lat) > tr.Width/2-1 {
			t.Errorf("slot %d lat %v", k, lat)
		}
		if s <= tr.Length-90 || s >= tr.Length {
			t.Errorf("slot %d s %v", k, s)
		}
		sg := tr.Segs[i]
		if d := wrap(p.H-math.Atan2(sg.TZ, sg.TX), 2*math.Pi); math.Abs(d) > 0.05 {
			t.Errorf("slot %d heading off by %v", k, d)
		}
	}
}

func maxCurv(xs, zs []float64) float64 {
	n := len(xs)
	m := 0.0
	for i := 0; i < n; i++ {
		a, b, c := (i+n-1)%n, i, (i+1)%n
		ax, az := xs[b]-xs[a], zs[b]-zs[a]
		bx, bz := xs[c]-xs[b], zs[c]-zs[b]
		cross := ax*bz - az*bx
		den := math.Hypot(ax, az) * math.Hypot(bx, bz) * math.Hypot(xs[c]-xs[a], zs[c]-zs[a])
		if k := math.Abs(2 * cross / den); k > m {
			m = k
		}
	}
	return m
}

func TestRacingLineWithinTrack(t *testing.T) {
	tr := Kiyi()
	n := len(tr.Segs)
	if len(tr.Line) != n {
		t.Fatalf("line len %d", len(tr.Line))
	}
	cx, cz, lx, lz := make([]float64, n), make([]float64, n), make([]float64, n), make([]float64, n)
	for i, s := range tr.Segs {
		if math.Abs(tr.Line[i]) > tr.Width/2-1.5+1e-9 {
			t.Fatalf("line[%d]=%v", i, tr.Line[i])
		}
		cx[i], cz[i] = s.X, s.Z
		lx[i], lz[i] = s.X+tr.Line[i]*s.NX, s.Z+tr.Line[i]*s.NZ
	}
	if c, l := maxCurv(cx, cz), maxCurv(lx, lz); l >= c {
		t.Fatalf("line curvature %v >= centre %v", l, c)
	}
}
