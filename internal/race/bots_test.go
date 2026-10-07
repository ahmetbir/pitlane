package race

import (
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/bot"
	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// TestBotTurnsAround: a stopped bot facing straight back anywhere across the track turns
// around without a reverse gear, never touches the wall and drives on. (Not covered: a car
// angled at a wall can reach it, and nose-first at a wall it stays: there is no reverse.)
func TestBotTurnsAround(t *testing.T) {
	tr := track.Kiyi()
	for _, h := range []car.Handling{car.Sim, car.Arcade} {
		prof := bot.NewProfile(tr, h)
		for _, s0 := range []float64{100, 1130, 2200} {
			for _, lat0 := range []float64{-16, -9, -4, 0, 4, 9, 16} {
				i := int(s0/tr.Length*float64(len(tr.Segs))) % len(tr.Segs)
				g := tr.Segs[i]
				x, z := tr.Point(s0, lat0)
				st := car.State{X: x, Z: z, HX: -g.TX, HZ: -g.TZ, Gear: 1} // facing straight back
				p := car.NewParams(h, bot.Setup(), car.Damage{})
				b := bot.NewBrain(0, prof)
				b.Skill = 0.9
				seg, s := i, s0
				wall, dist := false, 0.0
				for k := 0; k < 30*60; k++ {
					in := b.Drive(&st, &p, seg, nil, nil)
					j, _ := moveCar(&st, &p, in, tr, &seg)
					wall = wall || j > 0
					_, _, ns := tr.Locate(st.X, st.Z, seg)
					d := math.Mod(ns-s+1.5*tr.Length, tr.Length) - tr.Length/2
					dist, s = dist+d, ns
				}
				if dist < 100 || wall {
					t.Errorf("%v s=%v lat=%v: wall %v, progress %.0f m", h, s0, lat0, wall, dist)
				}
			}
		}
	}
}

// TestBotsHoldStillUnderLights: bot cars press nothing until lights out.
func TestBotsHoldStillUnderLights(t *testing.T) {
	r := New(Settings{Handling: car.Sim, Contact: Soft, Laps: 3, Seed: 5}, track.Kiyi())
	for r.Phase() != Lights {
		r.Step(nil)
	}
	for r.Phase() == Lights {
		r.Step(nil)
		if r.Phase() != Lights {
			break
		}
		for _, c := range r.cars {
			if c.St.X != c.slot.X || c.St.Z != c.slot.Z || c.PenaltyMs != 0 {
				t.Fatalf("car %d moved under the lights", c.ID)
			}
		}
	}
}
