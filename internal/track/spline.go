package track

import "math"

type pt struct{ x, z float64 }

// catmullRom samples the closed centripetal (alpha 0.5) Catmull–Rom spline through ctl at
// roughly `step` metre spacing, without repeating the first point.
func catmullRom(ctl []pt, step float64) []pt {
	n := len(ctl)
	var out []pt
	for i := 0; i < n; i++ {
		p0, p1, p2, p3 := ctl[(i+n-1)%n], ctl[i], ctl[(i+1)%n], ctl[(i+2)%n]
		t0 := 0.0
		t1 := t0 + math.Sqrt(dist(p0, p1))
		t2 := t1 + math.Sqrt(dist(p1, p2))
		t3 := t2 + math.Sqrt(dist(p2, p3))
		steps := int(math.Ceil(dist(p1, p2) / step))
		for k := 0; k < steps; k++ {
			t := t1 + (t2-t1)*float64(k)/float64(steps)
			a1 := mix(p0, p1, t0, t1, t)
			a2 := mix(p1, p2, t1, t2, t)
			a3 := mix(p2, p3, t2, t3, t)
			b1 := mix(a1, a2, t0, t2, t)
			b2 := mix(a2, a3, t1, t3, t)
			out = append(out, mix(b1, b2, t1, t2, t))
		}
	}
	return out
}

func dist(a, b pt) float64 { return math.Hypot(a.x-b.x, a.z-b.z) }

func mix(a, b pt, ta, tb, t float64) pt {
	u, v := (tb-t)/(tb-ta), (t-ta)/(tb-ta)
	return pt{a.x*u + b.x*v, a.z*u + b.z*v}
}

// resample returns n points evenly spaced by arc length along the closed polyline, the first one
// `origin` metres past poly[0], plus the polyline length.
func resample(poly []pt, origin float64) ([]pt, float64) {
	m := len(poly)
	cum := make([]float64, m+1)
	for i := 0; i < m; i++ {
		cum[i+1] = cum[i] + dist(poly[i], poly[(i+1)%m])
	}
	length := cum[m]
	n := int(length / 2)
	ds := length / float64(n)
	out := make([]pt, n)
	j := 0
	for i := 0; i < n; i++ {
		s := math.Mod(origin+float64(i)*ds, length)
		if i == 0 || s < cum[j] {
			j = 0
		}
		for cum[j+1] < s {
			j++
		}
		a, b := poly[j], poly[(j+1)%m]
		f := (s - cum[j]) / (cum[j+1] - cum[j])
		out[i] = pt{a.x + (b.x-a.x)*f, a.z + (b.z-a.z)*f}
	}
	return out, length
}
