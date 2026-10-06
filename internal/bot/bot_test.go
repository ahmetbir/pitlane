package bot_test

import (
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/bot"
	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/track"
)

// env mirrors the race's surface map.
func env(s track.Surface) car.Env {
	switch s {
	case track.Asphalt:
		return car.Env{Mu: 1}
	case track.Kerb:
		return car.Env{Mu: 0.9}
	}
	return car.Env{Mu: 0.55, Drag: 0.9}
}

type lapRun struct {
	laps    []float64 // s
	wall    bool
	offMax  int     // most off-track ticks in one lap
	maxLat  float64 // largest |lat| seen
	maxBeta float64 // largest |VY/VX| at speed (spin indicator)
	ticks   int
}

// soloLaps drives one bot (skill 0.98) from grid slot 0 for the given laps or ticks.
func soloLaps(h car.Handling, laps, maxTicks int) lapRun {
	tr := track.Kiyi()
	g := tr.Grid[0]
	st := car.State{X: g.X, Z: g.Z, H: g.H, HX: math.Cos(g.H), HZ: math.Sin(g.H), Gear: 1}
	p := car.NewParams(h, car.DefaultSetup(), car.Damage{})
	b := bot.NewBrain(0, bot.NewProfile(tr, h))
	b.Skill = 0.98
	seg, _, s := tr.Locate(st.X, st.Z, -1)
	var r lapRun
	off, start := 0, 0
	for r.ticks = 1; r.ticks <= maxTicks && len(r.laps) < laps; r.ticks++ {
		in := b.Drive(&st, &p, seg, nil, nil)
		_, lat, _ := tr.Locate(st.X, st.Z, seg)
		car.Step(&st, &p, in, env(tr.SurfaceAt(lat)))
		prev := s
		seg, lat, s = tr.Locate(st.X, st.Z, seg)
		r.maxLat = max(r.maxLat, math.Abs(lat))
		if math.Abs(lat) > tr.WallLat()-1 {
			r.wall = true
		}
		if math.Abs(lat) > tr.Width/2+tr.Kerb+0.95 {
			off++
		}
		if st.VX > 10 {
			r.maxBeta = max(r.maxBeta, math.Abs(st.VY/st.VX))
		}
		if prev > tr.Length-50 && s < 50 {
			r.laps = append(r.laps, float64(r.ticks-start)*car.DT) // laps[0]: the 10 m stub
			r.offMax = max(r.offMax, off)
			off, start = 0, r.ticks
		}
	}
	return r
}

func TestBotLapsTheTrack(t *testing.T) {
	L := track.Kiyi().Length
	for _, h := range []car.Handling{car.Sim, car.Arcade} {
		// The grid sits 10 m before the line: crossing 1 ends a stub, then 2 full laps.
		r := soloLaps(h, 3, int(2*L/30*60)+600)
		t.Logf("%v: laps %.2f s, maxLat %.2f m, maxBeta %.3f, offMax %d ticks", h, r.laps, r.maxLat, r.maxBeta, r.offMax)
		if len(r.laps) < 3 {
			t.Fatalf("%v: %d crossings in %d ticks", h, len(r.laps), r.ticks)
		}
		if tot := r.laps[1] + r.laps[2]; tot > 2*L/30 {
			t.Errorf("%v: 2 laps %.2f s > %.2f s", h, tot, 2*L/30)
		}
		if r.wall {
			t.Errorf("%v: touched the wall (max |lat| %.2f)", h, r.maxLat)
		}
		if r.offMax > 2*60 {
			t.Errorf("%v: lap invalid, %d off ticks", h, r.offMax)
		}
	}
}

// raceRun runs a bot-only race to its results and reports finishers and wall touches.
func raceRun(t *testing.T, h car.Handling, seed uint64) (rows []race.ResultRow, raceTicks int, walls int) {
	tr := track.Kiyi()
	r := race.New(race.Settings{Handling: h, Contact: race.Soft, Laps: 3, Seed: seed}, tr)
	start := 0
	for r.Tick() < 500*60 {
		ev := r.Step(nil)
		if ev.LightsOut {
			start = r.Tick()
		}
		for _, c := range r.Cars() {
			st := c.St
			for _, v := range []float64{st.X, st.Z, st.HX, st.HZ, st.VX, st.VY, st.R} {
				if math.IsNaN(v) || math.IsInf(v, 0) {
					t.Fatalf("car %d not finite at tick %d", c.ID, r.Tick())
				}
			}
			if start > 0 {
				if _, lat, _ := tr.Locate(st.X, st.Z, c.Seg); math.Abs(lat) > tr.WallLat()-1.001 {
					walls++
				}
			}
		}
		if ev.Results != nil {
			return ev.Results, r.Tick() - start, walls
		}
	}
	t.Fatal("no results")
	return nil, 0, 0
}

func TestBotsFinishARace(t *testing.T) {
	L := track.Kiyi().Length
	limit := 3*L/25 + 45
	for _, h := range []car.Handling{car.Sim, car.Arcade} {
		for _, seed := range []uint64{1, 2, 3} {
			rows, ticks, walls := raceRun(t, h, seed)
			worst := 0
			for _, row := range rows {
				if row.TotalMs == 0 {
					t.Errorf("%v seed %d: car %d did not finish (%d laps)", h, seed, row.Car, row.Laps)
				}
				worst = max(worst, row.TotalMs)
			}
			t.Logf("%v seed %d: winner %.2f s, last %.2f s, results after %.2f s, wall-contact ticks %d",
				h, seed, float64(rows[0].TotalMs)/1000, float64(worst)/1000, float64(ticks)/60, walls)
			if float64(worst)/1000 > limit {
				t.Errorf("%v seed %d: last finisher %.2f s > %.2f s", h, seed, float64(worst)/1000, limit)
			}
		}
	}
}

func TestBotDeterministic(t *testing.T) {
	prof := bot.NewProfile(track.Kiyi(), car.Sim)
	if bot.NewBrain(7, prof) != bot.NewBrain(7, prof) {
		t.Fatal("NewBrain not deterministic")
	}
	for seed := uint64(0); seed < 200; seed++ {
		if s := bot.NewBrain(seed, prof).Skill; s < 0.90 || s >= 0.98 {
			t.Fatalf("skill %v out of range", s)
		}
	}
	run := func() []car.State {
		r := race.New(race.Settings{Handling: car.Sim, Contact: race.Soft, Laps: 3, Seed: 9}, track.Kiyi())
		for r.Tick() < 90*60 {
			r.Step(nil)
		}
		var out []car.State
		for _, c := range r.Cars() {
			out = append(out, c.St)
		}
		return out
	}
	a, b := run(), run()
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("car %d diverged", i+1)
		}
	}
}
