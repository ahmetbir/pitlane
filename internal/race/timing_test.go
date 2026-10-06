package race

import (
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// timedRace is a Racing race with every car frozen far apart; tests teleport car 1.
func timedRace() *Race {
	r := contactRace(Ghost)
	r.raceStart = r.tick
	for _, c := range r.cars {
		c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
		c.LapStart, c.LapValid = r.tick, true
	}
	return r
}

// teleport moves car c to s on the centre line and runs one tick.
func teleport(r *Race, c *Car, s, lat float64) Events {
	put(r, c, s, lat, 0)
	return r.Step(nil)
}

// lapOf drives car c once round in 3 m steps starting just before the line.
func lapOf(r *Race, c *Car, lat float64) (laps []LapEvent) {
	L := r.tr.Length
	for s := L - 12; s < 2*L+12; s += 3 {
		ev := teleport(r, c, mod(s, L), lat)
		for _, l := range ev.Laps {
			if l.Car == c.ID {
				laps = append(laps, l)
			}
		}
	}
	return laps
}

func mod(a, m float64) float64 {
	for a >= m {
		a -= m
	}
	return a
}

func TestLapCountsWithAllSectors(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	put(r, c, r.tr.Length-12, 0, 0)
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	c.LapStart = r.tick
	start := r.tick
	laps := lapOf(r, c, 0)
	if len(laps) != 1 {
		t.Fatalf("laps %v", laps)
	}
	l := laps[0]
	if l.Lap != 1 || !l.Valid || l.Best != l.Ms || c.Lap != 1 || c.Best != l.Ms || c.Last != l.Ms {
		t.Fatalf("lap %+v car %+v", l, c)
	}
	if want := (r.tick - start) * 1000 / 60; l.Ms <= 0 || l.Ms > want {
		t.Fatalf("ms %d vs elapsed %d", l.Ms, want)
	}
	if c.Sector != 0 || c.OffTicks != 0 || c.LapStart == start {
		t.Fatalf("not reset: %+v", c)
	}
}

func TestLapMsExact(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	put(r, c, r.tr.Length-12, 0, 0)
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	c.LapStart = r.tick + 1 // first step below is tick+1
	n := 0
	var got LapEvent
	L := r.tr.Length
	for s := L - 12; s < 2*L+12 && got.Lap == 0; s += 3 {
		n++
		for _, l := range teleport(r, c, mod(s, L), 0).Laps {
			if l.Car == 1 {
				got = l
			}
		}
	}
	if want := (n - 1) * 1000 / 60; got.Ms != want {
		t.Fatalf("ms %d want %d", got.Ms, want)
	}
}

func TestShortcutDoesNotCount(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	L := r.tr.Length
	put(r, c, L-12, 0, 0)
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	// Skip sector 1: jump from just before it to just past it, then on to the line.
	for s := L - 12; s < L+30; s += 3 {
		x := mod(s, L)
		if x > r.tr.Sectors[1]-6 && x < r.tr.Sectors[1]+6 {
			continue
		}
		if ev := teleport(r, c, x, 0); len(ev.Laps) != 0 {
			t.Fatalf("lap at s=%v", x)
		}
	}
	if c.Lap != 0 || c.Sector == 2 {
		t.Fatalf("lap %d sector %d", c.Lap, c.Sector)
	}
}

func TestOffTrackLapInvalidButCounted(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	L := r.tr.Length
	// A valid lap first, then an invalid one that sits far off the track for 130 ticks.
	put(r, c, L-12, 0, 0)
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	c.LapStart = r.tick
	if laps := lapOf(r, c, 0); len(laps) != 1 || !laps[0].Valid {
		t.Fatalf("first lap %v", laps)
	}
	best := c.Best
	for i := 0; i < 130; i++ {
		teleport(r, c, r.tr.Sectors[1]-100, r.tr.Width/2+r.tr.Kerb+1.5)
	}
	if c.LapValid {
		t.Fatal("still valid after 130 off ticks")
	}
	var got []LapEvent
	for s := r.tr.Sectors[1] - 100; s < 2*L; s += 3 {
		ev := teleport(r, c, mod(s, L), 0)
		got = append(got, ev.Laps...)
		if len(got) > 0 {
			break
		}
	}
	if len(got) != 1 || got[0].Valid || got[0].Lap != 2 || c.Lap != 2 || c.Best != best || got[0].Best != best {
		t.Fatalf("laps %+v car lap %d best %d (was %d)", got, c.Lap, c.Best, best)
	}
}

func TestShortOffTrackStaysValid(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	for i := 0; i < 120; i++ {
		teleport(r, c, 500, r.tr.Width/2+r.tr.Kerb+1.5)
	}
	if !c.LapValid || c.OffTicks != 120 {
		t.Fatalf("valid %v off %d", c.LapValid, c.OffTicks)
	}
	teleport(r, c, 500, r.tr.Width/2+r.tr.Kerb+0.5) // on the kerb edge: not off
	if c.OffTicks != 120 {
		t.Fatal("kerb counted as off")
	}
}

func TestBackwardsOverLineDoesNotCount(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	L := r.tr.Length
	put(r, c, 20, 0, 0)
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	for s := 20.0; s > -20; s -= 3 {
		if ev := teleport(r, c, mod(s+L, L), 0); len(ev.Laps) != 0 {
			t.Fatal("lap going backwards")
		}
	}
	if c.Lap != 0 || c.Sector != 0 {
		t.Fatalf("lap %d sector %d", c.Lap, c.Sector)
	}
	// Then a normal forward lap from here still counts exactly once.
	laps := 0
	for s := L - 20; s < 2*L+20; s += 3 {
		laps += len(teleport(r, c, mod(s, L), 0).Laps)
	}
	if laps != 1 || c.Lap != 1 {
		t.Fatalf("laps %d car lap %d", laps, c.Lap)
	}
}

func TestBackwardsAfterLapDoesNotDoubleCount(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	L := r.tr.Length
	put(r, c, L-12, 0, 0)
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	lapOf(r, c, 0)
	n := 0
	for _, s := range []float64{3, 0, L - 3, L - 6, L - 3, 0, 3, 6} {
		n += len(teleport(r, c, s, 0).Laps)
	}
	if n != 0 || c.Lap != 1 {
		t.Fatalf("extra laps %d lap %d", n, c.Lap)
	}
}

func TestPositionsOrder(t *testing.T) {
	r := timedRace()
	a, b, c := r.cars[0], r.cars[1], r.cars[2]
	put(r, a, 100, 0, 0)
	put(r, b, 300, 0, 0)
	put(r, c, 200, 0, 0)
	c.rankLap = 1 // a lap up beats distance
	r.Step(nil)
	if !(c.Pos < b.Pos && b.Pos < a.Pos) {
		t.Fatalf("pos c%d b%d a%d", c.Pos, b.Pos, a.Pos)
	}
	// Finished cars come first, by finish tick.
	a.Finished, a.FinishTick = true, 10
	b.Finished, b.FinishTick = true, 5
	r.Step(nil)
	if b.Pos != 1 || a.Pos != 2 || c.Pos != 3 {
		t.Fatalf("finished: b%d a%d c%d", b.Pos, a.Pos, c.Pos)
	}
	// Ties fall to the lower ID; every Pos is unique.
	seen := map[int]bool{}
	for _, x := range r.cars {
		seen[x.Pos] = true
	}
	if len(seen) != numCars {
		t.Fatal("positions not a permutation")
	}
}

func TestGridCarsRankBeforeFirstCrossing(t *testing.T) {
	r := New(Settings{Handling: car.Arcade, Contact: Ghost, Laps: 3, Seed: 1}, track.Kiyi())
	r.phase = Racing
	r.raceStart = r.tick
	for _, c := range r.cars {
		c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	}
	r.Step(nil)
	for i, c := range r.cars {
		if c.Pos != i+1 {
			t.Fatalf("car %d pos %d", c.ID, c.Pos)
		}
	}
	// Car 1 rolls over the line (Sector 0, Lap 0): still first, no lap.
	put(r, r.cars[0], 5, 0, 0)
	if ev := r.Step(nil); len(ev.Laps) != 0 || r.cars[0].Pos != 1 {
		t.Fatalf("laps %v pos %d", ev.Laps, r.cars[0].Pos)
	}
}

func TestLeaderFinishEndsRaceAndOthersFinishOnCrossing(t *testing.T) {
	r := timedRace()
	r.set.Laps = 1
	a, b := r.cars[0], r.cars[1]
	L := r.tr.Length
	put(r, a, L-12, 0, 0)
	a.Seg, _, a.S = r.tr.Locate(a.St.X, a.St.Z, -1)
	put(r, b, L-12-200, 0, 0)
	b.Seg, _, b.S = r.tr.Locate(b.St.X, b.St.Z, -1)
	a.Sector, b.Sector = 2, 2
	r.Step(nil)
	for s := L - 12; s < L+12; s += 3 {
		put(r, a, mod(s, L), 0, 0)
		r.Step(nil)
	}
	if !a.Finished || !r.finishing || r.Phase() != Finish || b.Finished {
		t.Fatalf("a %v finishing %v phase %v b %v", a.Finished, r.finishing, r.Phase(), b.Finished)
	}
	for s := L - 12 - 200; s < L+12; s += 3 {
		put(r, b, mod(s, L), 0, 0)
		r.Step(nil)
	}
	if !b.Finished || b.FinishTick <= a.FinishTick || a.Pos != 1 || b.Pos != 2 {
		t.Fatalf("b fin %v tick %d/%d pos %d/%d", b.Finished, b.FinishTick, a.FinishTick, a.Pos, b.Pos)
	}
	// A finished car's lap count stays put.
	if a.Lap != 1 {
		t.Fatalf("lap %d", a.Lap)
	}
}

func TestResultsPenaltyReorders(t *testing.T) {
	r := timedRace()
	a, b := r.cars[0], r.cars[1]
	a.Finished, a.FinishTick, a.PenaltyMs = true, r.raceStart+600, 5000
	b.Finished, b.FinishTick = true, r.raceStart+700
	rows := r.results()
	if rows[0].Car != b.ID || rows[1].Car != a.ID || rows[0].Pos != 1 || a.Pos != 2 || b.Pos != 1 {
		t.Fatalf("rows %+v", rows[:3])
	}
	if rows[1].TotalMs != 15000 {
		t.Fatalf("total %d", rows[1].TotalMs)
	}
}

func TestSameTickFinishIgnoresIDOrder(t *testing.T) {
	r := timedRace()
	r.set.Laps = 2
	L := r.tr.Length
	lapped, leader := r.cars[0], r.cars[1] // lower ID is the lapped one
	for _, c := range []*Car{lapped, leader} {
		put(r, c, L-6, 0, 0)
		c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
		c.Sector, c.rankLap = 2, 1
	}
	leader.Lap, lapped.Lap = 1, 0
	r.Step(nil)
	put(r, lapped, 2, 0, 0)
	put(r, leader, 2, 0, 0)
	r.Step(nil)
	if !leader.Finished || !lapped.Finished || lapped.FinishTick != leader.FinishTick || r.Phase() != Finish {
		t.Fatalf("leader %v lapped %v phase %v", leader.Finished, lapped.Finished, r.Phase())
	}
}

func TestReversingOverLineDoesNotTakeLead(t *testing.T) {
	r := timedRace()
	L := r.tr.Length
	a, b := r.cars[0], r.cars[1]
	for _, c := range []*Car{a, b} {
		c.Lap, c.rankLap = 1, 1
	}
	put(r, b, 100, 0, 0)
	put(r, a, 20, 0, 0)
	r.Step(nil)
	if b.Pos >= a.Pos {
		t.Fatalf("setup: a%d b%d", a.Pos, b.Pos)
	}
	for _, s := range []float64{10, 3, L - 3, L - 10} {
		put(r, a, s, 0, 0)
		r.Step(nil)
		if a.Pos < b.Pos {
			t.Fatalf("a took the lead at s=%v", s)
		}
	}
	for _, s := range []float64{L - 3, 3, 20} { // and forward again, uncounted
		put(r, a, s, 0, 0)
		r.Step(nil)
	}
	if a.Lap != 1 || a.rankLap != 1 || a.Pos < b.Pos {
		t.Fatalf("lap %d rank %d pos %d", a.Lap, a.rankLap, a.Pos)
	}
}

func TestLineJitterAfterLapNoExtraLap(t *testing.T) {
	r := timedRace()
	c := r.cars[0]
	L := r.tr.Length
	put(r, c, L-12, 0, 0)
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
	lapOf(r, c, 0)
	if c.Lap != 1 {
		t.Fatalf("lap %d", c.Lap)
	}
	for i := 0; i < 60; i++ {
		s := 1.0
		if i%2 == 0 {
			s = L - 1
		}
		if ev := teleport(r, c, s, 0); len(ev.Laps) != 0 {
			t.Fatalf("extra lap at tick %d", i)
		}
	}
	if c.Lap != 1 {
		t.Fatalf("lap %d", c.Lap)
	}
}

func TestFinishTimeoutRanksUnfinishedByRoad(t *testing.T) {
	r := timedRace()
	r.set.Laps = 1
	L := r.tr.Length
	lead := r.cars[2]
	put(r, lead, L-6, 0, 0)
	lead.Seg, _, lead.S = r.tr.Locate(lead.St.X, lead.St.Z, -1)
	lead.Sector = 2
	r.Step(nil)
	put(r, lead, 2, 0, 0)
	r.Step(nil)
	if r.Phase() != Finish {
		t.Fatalf("phase %v", r.Phase())
	}
	start := r.Tick()
	var rows []ResultRow
	for i := 0; i < finishMaxTicks+5 && rows == nil; i++ {
		rows = r.Step(nil).Results
	}
	if rows == nil || r.Tick()-start < finishMaxTicks-1 || r.Tick()-start > finishMaxTicks+2 {
		t.Fatalf("results %v after %d ticks", rows != nil, r.Tick()-start)
	}
	if rows[0].Car != lead.ID || rows[0].TotalMs == 0 {
		t.Fatalf("first %+v", rows[0])
	}
	want := []CarID{10, 9, 8, 7, 6, 5, 4, 2, 1}
	for i, id := range want {
		if rows[i+1].Car != id || rows[i+1].TotalMs != 0 {
			t.Fatalf("row %d: %+v want car %d", i+1, rows[i+1], id)
		}
	}
}

func TestResultsLappedFinisherBehindLeaderLap(t *testing.T) {
	r := timedRace()
	a, b := r.cars[0], r.cars[1]
	a.Finished, a.Lap, a.FinishTick = true, 2, r.raceStart+600 // faster but a lap down
	b.Finished, b.Lap, b.FinishTick = true, 3, r.raceStart+900
	rows := r.results()
	if rows[0].Car != b.ID || rows[1].Car != a.ID {
		t.Fatalf("rows %+v", rows[:2])
	}
}
