package bot

import (
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// TestPassPlan: a standing car on the bot's path gets a pass on the side the path is on, in
// absolute track lat, unless that side leaves less than passWall to the wall; a car further
// than overlapLat from the path gets none, and one pulling away gets none either.
func TestPassPlan(t *testing.T) {
	tr := track.Kiyi()
	prof := NewProfile(tr, car.Sim)
	const sc, s = 600.0, 500.0
	lim := tr.WallLat() - carHalfWidth - passWall
	for _, c := range []struct {
		path, lat, ax float64
		np            int
		side, to      float64
	}{
		{2, 0, 0, 1, 1, passGap},                                                // path left of it: its left
		{-2, 0, 0, 1, -1, -passGap},                                             // path right of it: its right
		{15, 13, 0, 1, 1, 13 + passGap},                                         // left leaves room to the wall
		{15, 14.5, 0, 1, -1, 14.5 - passGap},                                    // left would leave < passWall: right
		{-15, -14.5, 0, 1, 1, -14.5 + passGap},                                  // mirrored
		{0, overlapLat, 0, 0, 0, 0},                                             // beside the path: not in the way
		{0, -overlapLat - 2, 0, 0, 0, 0},                                        // further still
		{0, 0, movingAX, 0, 0, 0},                                               // getting going
		{lim + 1, lim + 1 - passGap/2, 0, 1, -1, lim + 1 - passGap/2 - passGap}, // at the wall
	} {
		b := NewBrain(1, prof)
		b.Offset = c.path - lineAt(tr, sc)
		st := car.State{AX: c.ax}
		b.planPasses(s, b.pathAt(s), 30, []Other{{St: &st, S: sc, Lat: c.lat}})
		if b.np != c.np {
			t.Errorf("path %.1f car %.1f: %d passes, want %d", c.path, c.lat, b.np, c.np)
			continue
		}
		if c.np == 0 {
			continue
		}
		ps := b.passes[0]
		if ps.side != c.side || ps.to != c.to {
			t.Errorf("path %.1f car %.1f: side %.0f to %.2f, want %.0f %.2f", c.path, c.lat, ps.side, ps.to, c.side, c.to)
		}
		if got := b.pathAt(sc); math.Abs(got-ps.to) > 1e-9 {
			t.Errorf("path %.1f car %.1f: path beside it %.2f, want %.2f (absolute lat)", c.path, c.lat, got, ps.to)
		}
	}
}

// TestStandSpeed: far from a standing car straight ahead nothing is capped; close behind it,
// with no room to swerve, the cap is the speed that stops stopShort behind it; already
// clearLat beside it there is no cap.
func TestStandSpeed(t *testing.T) {
	tr := track.Kiyi()
	b := NewBrain(1, NewProfile(tr, car.Sim))
	st := car.State{}
	sc := 600.0
	b.planPasses(sc-300, 0, 60, []Other{{St: &st, S: sc, Lat: lineAt(tr, sc)}})
	if b.np != 1 {
		t.Fatalf("%d passes", b.np)
	}
	l := lineAt(tr, sc)
	if v := b.standSpeed(sc-300, l, 60); v < 60 {
		t.Errorf("300 m back: cap %.1f", v)
	}
	// 20 m back at 40 m/s: 20 − clearLen − reactT·40 = 6 m is too short to swerve 2.6 m on full
	// lock, so the cap stops it 8 m short at 18 m/s²: √(2·18·12).
	if v, want := b.standSpeed(sc-20, l, 40), math.Sqrt(2*18*12); math.Abs(v-want) > 1e-9 {
		t.Errorf("20 m back at 40 m/s: cap %.2f, want %.2f", v, want)
	}
	if v := b.standSpeed(sc-20, l+b.passes[0].side*clearLat, 40); v < 1e9 {
		t.Errorf("already beside it: cap %.2f", v)
	}
}
