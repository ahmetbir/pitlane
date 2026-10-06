package race

import (
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
)

const (
	softRadius    = 1.6    // m, disc per car
	softKeep      = 0.95   // speed kept per soft contact
	fullCorrect   = 0.8    // share of the overlap removed per tick
	restitution   = 0.25   // e
	friction      = 0.4    // Coulomb μ between cars
	damageImpulse = 9000.0 // N·s for a full unit of damage
	wingLost      = 0.6    // FrontWing above this: the wing is gone
	tangentMin    = 1e-9   // m/s: below this sliding speed no friction impulse
)

// resolveContacts settles every overlapping pair in ID order and returns the cars that
// lost their front wing this tick.
func (r *Race) resolveContacts() (lost []CarID) {
	if r.set.Contact == Ghost {
		return nil
	}
	var hurt [numCars]bool
	for i, a := range r.cars {
		for _, b := range r.cars[i+1:] {
			if r.set.Contact == Soft {
				softPair(&a.St, &b.St)
				continue
			}
			lost = fullPair(a, b, &hurt, lost)
		}
	}
	for i, c := range r.cars {
		if hurt[i] {
			c.P = car.NewParams(r.set.Handling, c.Driver.Setup, c.St.Dmg)
		}
	}
	return lost
}

// softPair: discs pushed apart, approaching normal velocity removed, 5 % speed lost.
func softPair(a, b *car.State) {
	d := vec{b.X - a.X, b.Z - a.Z}
	dist := d.len()
	if dist >= 2*softRadius {
		return
	}
	n := vec{1, 0}
	if dist > 0 {
		n = d.scale(1 / dist)
	}
	push := n.scale((2*softRadius - dist) / 2)
	a.X, a.Z = a.X-push.x, a.Z-push.z
	b.X, b.Z = b.X+push.x, b.Z+push.z

	va, vb := worldVel(a), worldVel(b)
	if vn := vb.sub(va).dot(n); vn < 0 {
		va, vb = va.add(n.scale(vn/2)), vb.sub(n.scale(vn/2))
	}
	setWorldVel(a, va.scale(softKeep))
	setWorldVel(b, vb.scale(softKeep))
}

// fullPair: SAT boxes, positional correction, impulse with friction and spin, damage.
func fullPair(a, b *Car, hurt *[numCars]bool, lost []CarID) []CarID {
	ba, bb := boxOf(&a.St), boxOf(&b.St)
	s, hit := satOBB(ba, bb)
	if !hit {
		return lost
	}
	p := contactPoint(ba, bb, s)
	corr := s.n.scale(fullCorrect * s.depth / 2)
	a.St.X, a.St.Z = a.St.X-corr.x, a.St.Z-corr.z
	b.St.X, b.St.Z = b.St.X+corr.x, b.St.Z+corr.z

	ra, rb := p.sub(ba.c), p.sub(bb.c)
	vn := pointVel(&b.St, rb).sub(pointVel(&a.St, ra)).dot(s.n)
	if vn >= 0 {
		return lost
	}
	j := -(1 + restitution) * vn / effMass(ra, rb, s.n)
	impulse(&a.St, ra, s.n.scale(-j))
	impulse(&b.St, rb, s.n.scale(j))

	rel := pointVel(&b.St, rb).sub(pointVel(&a.St, ra))
	t := rel.sub(s.n.scale(rel.dot(s.n)))
	if tl := t.len(); tl > tangentMin {
		t = t.scale(1 / tl)
		jt := -rel.dot(t) / effMass(ra, rb, t)
		jt = math.Max(-friction*j, math.Min(friction*j, jt))
		impulse(&a.St, ra, t.scale(-jt))
		impulse(&b.St, rb, t.scale(jt))
	}

	for _, c := range [2]*Car{a, b} {
		changed, gone := damage(&c.St, p, j/damageImpulse)
		if gone {
			lost = append(lost, c.ID)
		}
		hurt[c.ID-1] = hurt[c.ID-1] || changed
	}
	return lost
}

// effMass is the impulse denominator 2/m + (rA×u)²/Iz + (rB×u)²/Iz.
func effMass(ra, rb, u vec) float64 {
	ka, kb := ra.cross(u), rb.cross(u)
	return 2/car.Mass + ka*ka/car.Iz + kb*kb/car.Iz
}

// damage adds amount to the side of st that p hits (front, rear or middle third);
// it reports whether the damage changed and whether the front wing went past wingLost now.
func damage(st *car.State, p vec, amount float64) (changed, wingGone bool) {
	x := p.sub(vec{st.X, st.Z}).dot(vec{st.HX, st.HZ})
	v := &st.Dmg.Susp
	switch {
	case x > boxHalfLen/3:
		v = &st.Dmg.FrontWing
	case x < -boxHalfLen/3:
		v = &st.Dmg.RearWing
	}
	was := *v
	*v = math.Min(1, was+amount)
	return *v != was, v == &st.Dmg.FrontWing && was <= wingLost && *v > wingLost
}

// worldVel converts the body velocity to world axes.
func worldVel(st *car.State) vec {
	return vec{st.VX*st.HX - st.VY*st.HZ, st.VX*st.HZ + st.VY*st.HX}
}

func setWorldVel(st *car.State, v vec) {
	st.VX = v.x*st.HX + v.z*st.HZ
	st.VY = -v.x*st.HZ + v.z*st.HX
}

// pointVel is the world velocity of the body point at offset r from the centre.
func pointVel(st *car.State, r vec) vec {
	return worldVel(st).add(vec{-r.z, r.x}.scale(st.R))
}

// impulse applies the world impulse J at offset r.
func impulse(st *car.State, r, J vec) {
	setWorldVel(st, worldVel(st).add(J.scale(1/car.Mass)))
	st.R += r.cross(J) / car.Iz
}
