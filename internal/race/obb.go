package race

import (
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
)

// Car footprint for full contact: 5.4 × 1.9 m.
const (
	boxHalfLen = 2.7
	boxHalfWid = 0.95
	tieEps     = 1e-6 // m: vertices this close to the deepest one share the contact
)

type vec struct{ x, z float64 }

func (a vec) add(b vec) vec       { return vec{a.x + b.x, a.z + b.z} }
func (a vec) sub(b vec) vec       { return vec{a.x - b.x, a.z - b.z} }
func (a vec) scale(k float64) vec { return vec{a.x * k, a.z * k} }
func (a vec) dot(b vec) float64   { return a.x*b.x + a.z*b.z }
func (a vec) cross(b vec) float64 { return a.x*b.z - a.z*b.x }
func (a vec) len() float64        { return math.Sqrt(a.dot(a)) }

// box is a car footprint: centre and unit heading; body left is (−h.z, h.x).
type box struct{ c, h vec }

func boxOf(st *car.State) box { return box{vec{st.X, st.Z}, vec{st.HX, st.HZ}} }

func (b box) left() vec { return vec{-b.h.z, b.h.x} }

// axis k: 0 heading (half extent boxHalfLen), 1 left (boxHalfWid).
func (b box) axis(k int) (u vec, ext float64) {
	if k == 0 {
		return b.h, boxHalfLen
	}
	return b.left(), boxHalfWid
}

// radius is the half projection of the box on u.
func (b box) radius(u vec) float64 {
	return boxHalfLen*math.Abs(b.h.dot(u)) + boxHalfWid*math.Abs(b.left().dot(u))
}

func (b box) corners() [4]vec {
	f, l := b.h.scale(boxHalfLen), b.left().scale(boxHalfWid)
	return [4]vec{b.c.add(f).add(l), b.c.add(f).sub(l), b.c.sub(f).sub(l), b.c.sub(f).add(l)}
}

// sep is the minimum-overlap SAT axis: n unit from a to b, depth > 0,
// ref the box whose face owns the axis (0 = a, 1 = b) and k that face's axis index.
type sep struct {
	n     vec
	depth float64
	ref   int
	k     int
}

// satOBB tests two boxes on their four face axes (a's first; ties keep the first).
func satOBB(a, b box) (s sep, hit bool) {
	d := b.c.sub(a.c)
	s.depth = math.Inf(1)
	for i, o := range [2]box{a, b} {
		for k := 0; k < 2; k++ {
			u, _ := o.axis(k)
			p := d.dot(u)
			ov := a.radius(u) + b.radius(u) - math.Abs(p)
			if ov <= 0 {
				return sep{}, false
			}
			if ov < s.depth {
				if p < 0 {
					u = u.scale(-1)
				}
				s = sep{n: u, depth: ov, ref: i, k: k}
			}
		}
	}
	return s, true
}

// contactPoint is the middle of the incident face clipped to the reference face and kept
// where it penetrates (box2d style): a corner for a corner hit, the shared stretch for
// (nearly) parallel faces.
func contactPoint(a, b box, s sep) vec {
	ref, inc, out := a, b, s.n // out: from the reference box towards the incident one
	if s.ref == 1 {
		ref, inc, out = b, a, s.n.scale(-1)
	}
	// Incident face: the one facing back at the reference box most directly.
	var fn, ft vec
	var fe, te float64
	best := math.Inf(1)
	for k := 0; k < 2; k++ {
		u, e := inc.axis(k)
		t, et := inc.axis(1 - k)
		for _, sg := range [2]float64{1, -1} {
			if d := u.scale(sg).dot(out); d < best {
				best, fn, fe, ft, te = d, u.scale(sg), e, t, et
			}
		}
	}
	mid := inc.c.add(fn.scale(fe))
	p0, p1 := mid.sub(ft.scale(te)), mid.add(ft.scale(te))

	// Clip the segment to the reference face's extent along its tangent.
	t, ext := ref.axis(1 - s.k)
	q0, q1 := p0.sub(ref.c).dot(t), p1.sub(ref.c).dot(t)
	p0, p1 = clip(p0, p1, q0, q1, -ext), clip(p1, p0, q1, q0, -ext)
	q0, q1 = p0.sub(ref.c).dot(t), p1.sub(ref.c).dot(t)
	p0, p1 = clip(p0, p1, -q0, -q1, -ext), clip(p1, p0, -q1, -q0, -ext)

	// Keep the points behind the reference face.
	_, depthExt := ref.axis(s.k)
	var sum vec
	n := 0
	for _, p := range [2]vec{p0, p1} {
		if p.sub(ref.c).dot(out) <= depthExt+tieEps {
			sum, n = sum.add(p), n+1
		}
	}
	if n == 0 {
		return p0.add(p1).scale(0.5)
	}
	return sum.scale(1 / float64(n))
}

// clip moves p (coordinate q) towards o (coordinate qo) until q >= lo; the segment
// must reach lo somewhere (the boxes overlap), else p is returned unchanged.
func clip(p, o vec, q, qo, lo float64) vec {
	if q >= lo || qo < lo {
		return p
	}
	return p.add(o.sub(p).scale((lo - q) / (qo - q)))
}
