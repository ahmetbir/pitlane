package race

import (
	"math"
	"slices"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/track"
)

// marshalRace is a Racing race (timedRace) in which only car 1 races: every other car is
// finished and parked out on the grass, so it is neither reset nor in car 1's way.
func marshalRace() (*Race, *Car) { return marshalRaceIn(Ghost) }

func marshalRaceIn(mode Contact) (*Race, *Car) {
	r := timedRace()
	r.set.Contact = mode
	for _, c := range r.cars[1:] {
		put(r, c, c.S, -15, 0)
		c.Finished = true
	}
	return r, r.cars[0]
}

func TestMarshalResetsCarStuckOnWall(t *testing.T) {
	r, a := marshalRace()
	lim := r.tr.WallLat() - halfWidth
	put(r, a, 100, lim, 0)
	a.St.HX, a.St.HZ = a.St.HZ*-1, a.St.HX // turn 90° left: nose into the left wall
	a.St.H = math.Atan2(a.St.HZ, a.St.HX)
	a.St.Gear = 1
	push := map[CarID]car.Input{a.ID: {Throttle: 0.3}}
	for k := 1; k <= resetTicks; k++ {
		ev := r.Step(push)
		if got := slices.Contains(ev.Reset, a.ID); got != (k == resetTicks) {
			t.Fatalf("tick %d: reset %v (speed %.2f)", k, got, a.St.Speed())
		}
	}
	i, lat, _ := r.tr.Locate(a.St.X, a.St.Z, a.Seg)
	if math.Abs(lat-r.tr.Line[i]) > 0.05 || a.St.Speed() != 0 || a.St.HX*r.tr.Segs[i].TX+a.St.HZ*r.tr.Segs[i].TZ < 0.999 {
		t.Fatalf("after reset: lat %.2f line %.2f speed %.2f", lat, r.tr.Line[i], a.St.Speed())
	}

	r.Unseat(a.ID) // a bot drives it on
	t0 := r.Tick()
	for r.Tick()-t0 < 150*tps && a.Lap == 0 {
		r.Step(nil)
	}
	if a.Lap != 1 {
		t.Fatalf("no lap after the reset: s %.1f sector %d", a.S, a.Sector)
	}
	t.Logf("lap completed %.1f s after the reset", float64(r.Tick()-t0)/tps)
}

func TestMarshalIgnoresShortStops(t *testing.T) {
	r, a := marshalRace()
	put(r, a, 100, 10, 0) // on the grass: not drivable, so standing counts
	a.St.Gear = 1
	step := func(in car.Input) {
		if ev := r.Step(map[CarID]car.Input{a.ID: in}); slices.Contains(ev.Reset, a.ID) {
			t.Fatalf("reset at tick %d (slow %d)", r.Tick(), a.slow)
		}
	}
	for range resetTicks - 50 {
		step(car.Input{})
	}
	for a.St.Speed() < 2 {
		step(car.Input{Throttle: 1})
	}
	for a.St.Speed() > 0 {
		step(car.Input{Brake: 1})
	}
	for range resetTicks - 50 { // the count started again when the car moved
		step(car.Input{})
	}
}

// TestMarshalLeavesDrivableCarsAlone: a car standing straight on the asphalt is never reset,
// however long it stands; on the grass or facing more than 45° off the track it is.
func TestMarshalLeavesDrivableCarsAlone(t *testing.T) {
	for _, c := range []struct {
		lat, turn float64
		reset     bool
	}{
		{0, 0, false}, {-6.5, 0, false}, {3, 0.7, false}, // asphalt, within 45°
		{10, 0, true}, {0, 0.9, true}, {0, math.Pi, true}, // grass, 52° off, backwards
	} {
		r, a := marshalRace()
		put(r, a, 100, c.lat, 0)
		h := math.Atan2(a.St.HZ, a.St.HX) + c.turn
		a.St.H, a.St.HX, a.St.HZ, a.St.Gear = h, math.Cos(h), math.Sin(h), 1
		got := false
		for k := 0; k < 2*resetTicks && !got; k++ {
			got = slices.Contains(r.Step(nil).Reset, a.ID)
		}
		if got != c.reset {
			t.Errorf("lat %.1f turned %.2f rad: reset %v", c.lat, c.turn, got)
		}
	}
}

func TestMarshalNeverResetsFinishedCars(t *testing.T) {
	r, a := marshalRace()
	put(r, a, 100, 10, 0) // on the grass: would be reset if unfinished
	a.Finished = true
	for k := 0; k < 3*resetTicks; k++ {
		if ev := r.Step(nil); len(ev.Reset) > 0 {
			t.Fatalf("tick %d: reset %v", k, ev.Reset)
		}
	}
}

// noseIn parks c nose-first against the left wall at s, at rest.
func noseIn(r *Race, c *Car, s float64) {
	put(r, c, s, r.tr.WallLat()-halfWidth, 0)
	c.St.HX, c.St.HZ = -c.St.HZ, c.St.HX
	c.St.H = math.Atan2(c.St.HZ, c.St.HX)
	c.St.Gear = 1
}

// TestMarshalWaitsForTraffic: a reset due while a bot closes in at 45 m/s from 29 m behind
// waits until the bot has gone by; with full contact nobody is damaged.
func TestMarshalWaitsForTraffic(t *testing.T) {
	r, a := marshalRaceIn(Full)
	noseIn(r, a, 200)
	a.slow = resetTicks - 1 // the reset is due on the next tick
	b := r.cars[1]
	i := 85 // seg at s ≈ 171
	put(r, b, 171, r.tr.Line[i], 45)
	b.Finished, b.Driver.Human = false, false
	b.Seg, _, b.S = r.tr.Locate(b.St.X, b.St.Z, -1)
	at := -1
	for k := 0; k < 10*tps && at < 0; k++ {
		ev := r.Step(nil)
		if slices.Contains(ev.Reset, a.ID) {
			at = k
			if ahead := math.Mod(b.S-a.S+r.tr.Length, r.tr.Length); ahead <= resetAhead || ahead > r.tr.Length/2 {
				t.Fatalf("reset with the bot %.1f m ahead", ahead)
			}
		}
	}
	if at < 1 {
		t.Fatalf("reset at tick %d", at)
	}
	for k := 0; k < 3*tps; k++ {
		r.Step(nil)
	}
	if a.St.Dmg != (car.Damage{}) || b.St.Dmg != (car.Damage{}) {
		t.Fatalf("damage A %+v B %+v", a.St.Dmg, b.St.Dmg)
	}
	t.Logf("reset after %d held ticks", at)
}

// TestIdleHumanDoesNotFreezeTheRace: a human who never presses anything after lights out
// stands on the grid, is never reset (it is drivable) and is passed by every bot, which all
// finish.
func TestIdleHumanDoesNotFreezeTheRace(t *testing.T) {
	for _, mode := range []Contact{Soft, Full} {
		for _, h := range []car.Handling{car.Sim, car.Arcade} {
			r := New(Settings{Handling: h, Contact: mode, Laps: 3, Seed: 11}, track.Kiyi())
			id, _ := r.Seat("idle", "")
			r.Ready(id, car.DefaultSetup())
			start, resets := 0, map[CarID]int{}
			var rows []ResultRow
			for r.Tick() < 600*tps && rows == nil {
				ev := r.Step(nil)
				if ev.LightsOut {
					start = r.Tick()
				}
				for _, c := range ev.Reset {
					resets[c]++
				}
				rows = ev.Results
			}
			limit := 3*r.tr.Length/25 + 45
			if resets[id] != 0 {
				t.Errorf("%v %v: the idle human, straight on the asphalt, was reset %d times", mode, h, resets[id])
			}
			for _, row := range rows {
				if row.Human {
					continue
				}
				if row.TotalMs == 0 || float64(row.TotalMs)/1000 > limit {
					t.Errorf("%v %v: bot %d laps %d total %d ms", mode, h, row.Car, row.Laps, row.TotalMs)
				}
				if resets[row.Car] > 1 {
					t.Errorf("%v %v: bot %d reset %d times", mode, h, row.Car, resets[row.Car])
				}
			}
			t.Logf("%v %v: results %.1f s after the start, resets %v, held %d", mode, h, float64(r.Tick()-start)/tps, resets, r.held)
		}
	}
}

// TestHairpinQueueClears: bots stopped nose to tail on the line in the hairpin, with a human
// standing at the front of the queue, all get going and leave the hairpin; none is reset twice.
func TestHairpinQueueClears(t *testing.T) {
	for _, mode := range []Contact{Soft, Full} {
		r := New(Settings{Handling: car.Sim, Contact: mode, Laps: 3, Seed: 3}, track.Kiyi())
		r.phase, r.raceStart = Racing, r.tick
		id, _ := r.Seat("idle", "") // in Racing the last-placed bot's car: put it at the front
		slot := 1
		for _, c := range r.cars {
			i := 0
			if c.ID != id {
				i, slot = slot, slot+1
			}
			s := 1130 - 8*float64(i)
			put(r, c, s, r.tr.Line[int(s/2)], 0)
			c.St.Gear = 1
			c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
			c.LapStart = r.tick
		}
		resets := map[CarID]int{}
		for k := 0; k < 60*tps; k++ {
			for _, c := range r.Step(nil).Reset {
				resets[c]++
			}
		}
		if n := len(resets); n != 0 {
			t.Errorf("%v: resets %v (every car stands straight on the asphalt)", mode, resets)
		}
		for _, c := range r.cars {
			if c.ID == id {
				continue
			}
			if c.S < 1300 && c.Lap == 0 {
				t.Errorf("%v: bot %d still at s %.0f", mode, c.ID, c.S)
			}
			if resets[c.ID] > 1 {
				t.Errorf("%v: bot %d reset %d times", mode, c.ID, resets[c.ID])
			}
		}
		t.Logf("%v: resets %v, held %d", mode, resets, r.held)
	}
}

// stuckOnGrass parks c at rest on the grass at (s, lat), facing down the track: not drivable,
// so the marshal counts it.
func stuckOnGrass(r *Race, c *Car, s, lat float64) {
	put(r, c, s, lat, 0)
	c.St.Gear = 1
	c.Finished = false
	c.Seg, _, c.S = r.tr.Locate(c.St.X, c.St.Z, -1)
}

func dist(a, b *Car) float64 { return math.Hypot(a.St.X-b.St.X, a.St.Z-b.St.Z) }

// TestMarshalHoldIsBounded: a car crawling 60 m behind a stuck one, every tick, holds its reset
// holdMax ticks and no longer; then the stuck car goes to the asphalt edge with fewer cars,
// pointing down the track, edgeIn inside the edge.
func TestMarshalHoldIsBounded(t *testing.T) {
	r, a := marshalRaceIn(Full)
	noseIn(r, a, 300)
	b := r.cars[1]
	b.Finished = false
	got := -1
	for k := 1; k <= resetTicks+holdMax+5 && got < 0; k++ {
		put(r, b, 240, -4, 2)
		b.Seg, _, b.S = r.tr.Locate(b.St.X, b.St.Z, -1)
		if slices.Contains(r.Step(nil).Reset, a.ID) {
			got = k
		}
	}
	if got != resetTicks+holdMax {
		t.Fatalf("reset at tick %d, want %d", got, resetTicks+holdMax)
	}
	i, lat, _ := r.tr.Locate(a.St.X, a.St.Z, a.Seg)
	if math.Abs(math.Abs(lat)-(r.tr.Width/2-edgeIn)) > 0.05 || a.St.HX*r.tr.Segs[i].TX+a.St.HZ*r.tr.Segs[i].TZ < 0.999 {
		t.Fatalf("after the held reset: lat %.2f, heading·tangent %.3f", lat, a.St.HX*r.tr.Segs[i].TX+a.St.HZ*r.tr.Segs[i].TZ)
	}
	if lat < 0 { // b crawls on the right (lat −4): the left has fewer cars
		t.Errorf("dropped on the right (lat %.2f), where b is", lat)
	}
}

// TestMarshalDropsOnAFreeSpot: a reset never lands within dropFree of another car: two cars
// due on the same tick side by side, a stuck car beside an idle human on the racing line, and
// a stuck car just past the start line with that line's spot taken (it goes back over the
// line and its progress stays continuous).
func TestMarshalDropsOnAFreeSpot(t *testing.T) {
	for _, mode := range []Contact{Soft, Full} {
		r, a := marshalRaceIn(mode)
		b := r.cars[1]
		stuckOnGrass(r, a, 500, 10)
		stuckOnGrass(r, b, 502, 13)
		at := -1
		for k := 1; k <= resetTicks && at < 0; k++ {
			if ev := r.Step(nil); len(ev.Reset) > 0 {
				at = k
				if !slices.Equal(ev.Reset, []CarID{a.ID, b.ID}) {
					t.Fatalf("%v: reset %v", mode, ev.Reset)
				}
			}
		}
		if at != resetTicks || dist(a, b) < dropFree {
			t.Fatalf("%v: reset at tick %d, %.2f m apart", mode, at, dist(a, b))
		}
	}

	r, a := marshalRaceIn(Full)
	b := r.cars[1]
	stuckOnGrass(r, a, 600, 12)
	stuckOnGrass(r, b, 600, r.tr.Line[300]) // standing straight on the line: never reset itself
	for k := 1; k <= resetTicks; k++ {
		r.Step(nil)
	}
	if d := dist(a, b); d < dropFree || a.S >= b.S || a.S < 600-dropBack {
		t.Fatalf("beside the idle car: dropped %.2f m from it at s %.1f", d, a.S)
	}
	if b.slow != 0 || b.St.Dmg != (car.Damage{}) || a.St.Dmg != (car.Damage{}) {
		t.Fatalf("idle car slow %d, damage %+v %+v", b.slow, a.St.Dmg, b.St.Dmg)
	}

	r, a = marshalRaceIn(Ghost)
	b = r.cars[1]
	stuckOnGrass(r, a, 4, 12)
	stuckOnGrass(r, b, 4, r.tr.Line[2])
	a.rankLap, a.Lap, a.Sector = 1, 1, 0 // it has just completed lap 1
	before := r.progress(a)
	for k := 1; k <= resetTicks; k++ {
		r.Step(nil)
	}
	if d := dist(a, b); d < dropFree || a.S < r.tr.Length-dropBack || a.rankLap != 0 || a.Lap != 1 {
		t.Fatalf("over the line: %.2f m from b at s %.1f, rankLap %d lap %d", d, a.S, a.rankLap, a.Lap)
	}
	if back := before - r.progress(a); back <= 0 || back > dropBack+1 {
		t.Fatalf("progress moved %.1f m back", back)
	}
}
