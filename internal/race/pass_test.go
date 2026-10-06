package race

import (
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// passRes is one bot's run past a car standing at (sb, lb).
type passRes struct {
	wall, overlap, ticks int
	dmg, done            bool
	maxOffLine           float64 // largest |lat − line| over the first 450 m
	side                 float64 // bot lat − standing car lat as the bot drew level (0: never)
}

// passRun: full contact, a bot at 0.9 of the profile speed on the line 500 m before sb, a car
// standing at (sb, lb) facing down the track (withB), every other car finished and parked by
// the wall. The run ends 650 m on or after 60 s.
func passRun(h car.Handling, sb, lb float64, withB bool) passRes {
	r := New(Settings{Handling: h, Contact: Full, Laps: 50, Seed: 1}, track.Kiyi())
	r.phase, r.raceStart = Racing, r.tick
	L := r.tr.Length
	for i, c := range r.cars {
		c.Driver.Human, c.Finished = true, true
		put(r, c, math.Mod(float64(i)*40+5, L), -19, 0)
		c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	}
	a, b := r.cars[0], r.cars[1]
	a.Driver.Human, a.Finished = false, false
	sa := math.Mod(sb-500+L, L)
	ia := int(math.Round(sa/2)) % len(r.tr.Segs)
	put(r, a, sa, r.tr.Line[ia], 0.9*r.prof.Speed(ia))
	a.Seg, _, a.S = r.tr.Locate(a.St.X, a.St.Z, -1)
	if withB {
		put(r, b, sb, lb, 0)
		b.St.Gear = 1
		b.Seg, _, b.S = r.tr.Locate(b.St.X, b.St.Z, -1)
	}
	var res passRes
	trav, prev := 0.0, a.S
	for k := 0; k < 60*tps; k++ {
		r.Step(nil)
		res.ticks++
		_, lat, s := r.tr.Locate(a.St.X, a.St.Z, a.Seg)
		d := math.Mod(s-prev+1.5*L, L) - L/2
		trav += d
		prev = s
		if withB && res.side == 0 && trav >= 500 {
			_, bl, _ := r.tr.Locate(b.St.X, b.St.Z, b.Seg)
			res.side = lat - bl
		}
		if math.Abs(lat) >= r.tr.WallLat()-halfWidth-1e-9 {
			res.wall++
		}
		if withB && overlapping(a, b) {
			res.overlap++
		}
		if dl := math.Abs(lat - r.tr.Line[int(s/2)%len(r.tr.Segs)]); dl > res.maxOffLine && trav < 450 {
			res.maxOffLine = dl
		}
		if trav > 650 {
			res.done = true
			break
		}
	}
	res.dmg = a.St.Dmg != (car.Damage{})
	return res
}

// TestBotsPassStandingCars: a bot at speed meets a car standing on the asphalt where earlier
// bots hit it (hairpin entry and exit, the racing line sweeping across, the car beside the
// line or on it) and goes round it untouched, off the wall, in both handlings.
func TestBotsPassStandingCars(t *testing.T) {
	spots := [][2]float64{
		{300, 3}, {1000, 3}, {1000, 5}, {1100, -5}, {1100, -3}, {1100, 0}, {1150, -3},
		{1200, -5}, {1200, -3}, {1200, 0}, {1250, -5}, {1350, -3}, {1350, 0}, {1550, 3},
		{1600, 3}, {1600, 5}, {1750, 5}, {1900, 5}, {2750, -3}, {2750, 0}, {2800, -5},
		{2800, -3}, {2800, 0}, {3050, 3}, {3050, 5}, {3100, 5},
	}
	for _, h := range []car.Handling{car.Sim, car.Arcade} {
		for _, sp := range spots {
			p := passRun(h, sp[0], sp[1], true)
			if p.overlap > 0 || p.wall > 0 || p.dmg || !p.done {
				t.Errorf("%v car at s %.0f lat %.0f: contact %d ticks, wall %d ticks, damage %v, done %v",
					h, sp[0], sp[1], p.overlap, p.wall, p.dmg, p.done)
			}
		}
	}
}

// TestBotPassesOnItsOwnSide: on the straight after the start, a car standing 1.5 m to one side
// of the racing line is passed on the line's side, at least clearLat beside it.
func TestBotPassesOnItsOwnSide(t *testing.T) {
	const sb = 300
	line := track.Kiyi().Line[sb/2]
	for _, h := range []car.Handling{car.Sim, car.Arcade} {
		for _, d := range []float64{-1.5, 1.5} {
			p := passRun(h, sb, line+d, true)
			if p.side*d > -2.6 || p.overlap > 0 {
				t.Errorf("%v car %.1f m off the line: passed %.2f m beside it (want %.1f side), contact %d",
					h, d, p.side, -math.Copysign(1, d), p.overlap)
			}
		}
	}
}

// TestBotsIgnoreStandingCarsOffTheirPath: a car standing more than overlapLat from where the
// bot's line passes it is neither swerved round nor slowed for (earlier bots did both).
func TestBotsIgnoreStandingCarsOffTheirPath(t *testing.T) {
	spots := [][2]float64{{100, 3}, {350, -3}, {1100, 3}, {1150, 3}, {1650, -3}, {2800, 3}}
	for _, h := range []car.Handling{car.Sim, car.Arcade} {
		for _, sp := range spots {
			base := passRun(h, sp[0], 0, false)
			p := passRun(h, sp[0], sp[1], true)
			extra := float64(p.ticks-base.ticks) / tps
			if p.maxOffLine > base.maxOffLine+0.5 || extra > 0.05 || p.overlap > 0 {
				t.Errorf("%v car at s %.0f lat %.0f: off the line %.2f m (alone %.2f), %.2f s lost, contact %d",
					h, sp[0], sp[1], p.maxOffLine, base.maxOffLine, extra, p.overlap)
			}
		}
	}
}
