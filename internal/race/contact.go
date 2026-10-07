package race

import (
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
)

const (
	softKeep      = 0.95   // speed kept per soft bump (cars closing in)
	fullCorrect   = 0.8    // share of the overlap removed per tick
	restitution   = 0.25   // e
	friction      = 0.4    // Coulomb μ between cars
	damageDead    = 1000.0 // N·s absorbed without damage (rubs, nudges)
	damageImpulse = 8000.0 // N·s above the dead zone for a full unit of damage
	tangentMin    = 1e-9   // m/s: below this sliding speed no friction impulse
	closingMin    = 1e-9   // m/s: below this closing speed a soft overlap is resting (rounding)
)

// wallHit is one car's barrier contact this tick (moveCar's impulse and outward normal).
type wallHit struct {
	j float64
	n vec
}

// harm collects this tick's damage: which cars changed and which lost the front wing.
type harm struct {
	hurt [numCars]bool
	lost []CarID
}

// hit adds the damage of impulse j to the side of c at local x (m along the heading):
// front third → FrontWing, rear third → RearWing, else Susp.
func (h *harm) hit(c *Car, x, j float64) {
	amount := math.Max(0, j-damageDead) / damageImpulse
	if amount == 0 {
		return
	}
	v := &c.St.Dmg.Susp
	switch {
	case x > boxHalfLen/3:
		v = &c.St.Dmg.FrontWing
	case x < -boxHalfLen/3:
		v = &c.St.Dmg.RearWing
	}
	was := *v
	*v = math.Min(1, was+amount)
	if *v == was {
		return
	}
	h.hurt[c.ID-1] = true
	if v == &c.St.Dmg.FrontWing && !(car.Damage{FrontWing: was}).FrontWingLost() && c.St.Dmg.FrontWingLost() {
		h.lost = append(h.lost, c.ID)
	}
}

// resolveContacts settles every overlapping pair in ID order, keeps the cars inside the
// barrier and, in full contact, applies car and wall damage (walls may be nil). It
// returns the cars that lost their front wing this tick.
func (r *Race) resolveContacts(walls *[numCars]wallHit) []CarID {
	if r.set.Contact == Ghost {
		return nil
	}
	var h harm
	if r.set.Contact == Full && walls != nil {
		for i, c := range r.cars {
			if w := walls[i]; w.j > 0 {
				h.hit(c, w.n.dot(vec{c.St.HX, c.St.HZ})*boxHalfLen, w.j)
			}
		}
	}
	for i, a := range r.cars {
		for _, b := range r.cars[i+1:] {
			if r.set.Contact == Soft {
				softPair(&a.St, &b.St)
				continue
			}
			fullPair(a, b, &h)
		}
	}
	for i, c := range r.cars {
		keepInside(&c.St, r.tr, &c.Seg)
		if h.hurt[i] {
			c.P = car.NewParams(r.set.Handling, c.Driver.Setup, c.St.Dmg)
		}
	}
	return h.lost
}

// softPair: overlapping boxes pushed apart along the separating normal (half the depth
// each). Cars that are closing in lose the approaching normal velocity and 5 % of their
// speed (a bump); a resting or sliding overlap is only separated. No spin, no damage.
func softPair(a, b *car.State) {
	s, hit := satOBB(boxOf(a), boxOf(b))
	if !hit {
		return
	}
	push := s.n.scale(s.depth / 2)
	a.X, a.Z = a.X-push.x, a.Z-push.z
	b.X, b.Z = b.X+push.x, b.Z+push.z

	va, vb := worldVel(a), worldVel(b)
	if vn := vb.sub(va).dot(s.n); vn < -closingMin {
		va, vb = va.add(s.n.scale(vn/2)), vb.sub(s.n.scale(vn/2))
		setWorldVel(a, va.scale(softKeep))
		setWorldVel(b, vb.scale(softKeep))
	}
}

// fullPair: SAT boxes, positional correction, impulse with friction and spin, damage.
func fullPair(a, b *Car, h *harm) {
	ba, bb := boxOf(&a.St), boxOf(&b.St)
	s, hit := satOBB(ba, bb)
	if !hit {
		return
	}
	p := contactPoint(ba, bb, s)
	corr := s.n.scale(fullCorrect * s.depth / 2)
	a.St.X, a.St.Z = a.St.X-corr.x, a.St.Z-corr.z
	b.St.X, b.St.Z = b.St.X+corr.x, b.St.Z+corr.z

	ra, rb := p.sub(vec{a.St.X, a.St.Z}), p.sub(vec{b.St.X, b.St.Z})
	vn := pointVel(&b.St, rb).sub(pointVel(&a.St, ra)).dot(s.n)
	if vn >= 0 {
		return
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

	h.hit(a, ra.dot(vec{a.St.HX, a.St.HZ}), j)
	h.hit(b, rb.dot(vec{b.St.HX, b.St.HZ}), j)
}

// effMass is the impulse denominator 2/m + (rA×u)²/Iz + (rB×u)²/Iz.
func effMass(ra, rb, u vec) float64 {
	ka, kb := ra.cross(u), rb.cross(u)
	return 2/car.Mass + ka*ka/car.Iz + kb*kb/car.Iz
}

// worldVel converts the body velocity to world axes.
func worldVel(st *car.State) vec {
	return vec{float64(st.VX*st.HX) - float64(st.VY*st.HZ), float64(st.VX*st.HZ) + float64(st.VY*st.HX)}
}

func setWorldVel(st *car.State, v vec) {
	st.VX = float64(v.x*st.HX) + float64(v.z*st.HZ)
	st.VY = float64(-v.x*st.HZ) + float64(v.z*st.HX)
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
