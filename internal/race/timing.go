package race

import (
	"math"
	"sort"
)

const (
	lineWindow   = 50.0 // metres either side of s=0 in which a wrap counts as a line crossing
	offTrackLeft = 0.95 // centre this far beyond the kerb means all four wheels are off
	maxOffTicks  = 2 * tps
)

// timing advances sectors, laps, lap validity, finish state and positions for every car.
func (r *Race) timing(ev *Events) {
	L := r.tr.Length
	var done []*Car // cars that completed a lap this tick
	for _, c := range r.cars {
		var lat float64
		prev := c.S
		c.Seg, lat, c.S = r.tr.Locate(c.St.X, c.St.Z, c.Seg)
		if c.Finished {
			continue
		}
		if math.Abs(lat) > r.tr.Width/2+r.tr.Kerb+offTrackLeft {
			c.OffTicks++
		}
		c.LapValid = c.OffTicks <= maxOffTicks

		switch {
		case prev > L-lineWindow && c.S < lineWindow: // forward over the line
			c.rankLap++
			if c.Sector == 2 {
				r.completeLap(c, ev)
				done = append(done, c)
			}
		case prev < lineWindow && c.S > L-lineWindow: // backward over the line: never counts
			c.rankLap--
		default:
			r.advanceSector(c, prev)
		}
	}
	// The finish is decided after every lap of this tick is in, so car order cannot matter.
	for _, c := range done {
		if c.Lap >= r.set.Laps {
			r.finishing = true
		}
	}
	if r.finishing {
		for _, c := range done {
			c.Finished, c.FinishTick = true, r.tick
		}
	}
	r.rank()
	if r.finishing && len(done) > 0 {
		ev.Finished = r.flagged(done)
	}
}

// advanceSector moves the sector marker over the boundaries between prev and c.S, in order only.
func (r *Race) advanceSector(c *Car, prev float64) {
	for k := 1; k <= 2; k++ {
		b := r.tr.Sectors[k]
		switch {
		case prev < b && c.S >= b && c.Sector == k-1:
			c.Sector = k
		case prev >= b && c.S < b && c.Sector == k:
			c.Sector = k - 1
		}
	}
}

func (r *Race) completeLap(c *Car, ev *Events) {
	ms := (r.tick - c.LapStart) * 1000 / tps
	valid := c.LapValid
	if c.LapStart >= c.credTick { // a lap the seated driver drove from the line
		c.ownFull = true
		if valid && (c.ownBest == 0 || ms < c.ownBest) {
			c.ownBest = ms
		}
	}
	c.Lap++
	c.Last = ms
	if valid && (c.Best == 0 || ms < c.Best) {
		c.Best = ms
	}
	ev.Laps = append(ev.Laps, LapEvent{Car: c.ID, Lap: c.Lap, Ms: ms, Valid: valid, Best: c.Best})
	c.LapStart, c.Sector, c.OffTicks, c.LapValid = r.tick, 0, 0, true
}

// progress is the distance raced, from the net line crossings rather than the counted laps.
func (r *Race) progress(c *Car) float64 { return float64(c.rankLap)*r.tr.Length + c.S }

// rank orders the cars: finished by finish tick, then by progress, then by ID.
func (r *Race) rank() {
	cs := append([]*Car(nil), r.cars[:]...)
	sort.SliceStable(cs, func(i, j int) bool {
		a, b := cs[i], cs[j]
		if a.Finished != b.Finished {
			return a.Finished
		}
		if a.Finished && a.FinishTick != b.FinishTick {
			return a.FinishTick < b.FinishTick
		}
		if pa, pb := r.progress(a), r.progress(b); pa != pb {
			return pa > pb
		}
		return a.ID < b.ID
	})
	for i, c := range cs {
		c.Pos = i + 1
	}
}
