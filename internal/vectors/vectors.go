// Package vectors builds the Go-written test vectors the TypeScript port
// replays: car cases (setup, damage, inputs, sampled states), track cases
// (Point and Locate) and the sampled Kiyi circuit the client loads. Floats
// are written with encoding/json, which round-trips every float64 exactly.
package vectors

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/track"
)

const (
	carCases   = 40 // random cases; the scripted ones follow
	carTicks   = 600
	sampleEach = 30
	trackCases = 50
)

// rng is splitmix64.
type rng struct{ s uint64 }

func (r *rng) next() uint64 {
	r.s += 0x9e3779b97f4a7c15
	z := r.s
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

func (r *rng) float() float64 { return float64(r.next()>>11) / (1 << 53) }

// rangeF is uniform in [lo, hi).
func (r *rng) rangeF(lo, hi float64) float64 { return lo + float64((hi-lo)*r.float()) }

// rangeI is uniform in [lo, hi].
func (r *rng) rangeI(lo, hi int) int { return lo + int(r.next()%uint64(hi-lo+1)) }

type envSeg struct {
	T    int     `json:"t"` // first tick it applies to
	Mu   float64 `json:"mu"`
	Drag float64 `json:"drag"`
}

type carCase struct {
	Handling string      `json:"handling"`
	Setup    car.Setup   `json:"setup"`
	Dmg      car.Damage  `json:"dmg"`
	Params   car.Params  `json:"params"`
	Init     car.State   `json:"init"`
	Inputs   [][4]int8   `json:"inputs"` // wire units: th/100, br/100, st/127, rv 0|1, one per tick
	Env      []envSeg    `json:"env"`
	States   []car.State `json:"states"` // after ticks 30, 60, …
}

type carFile struct {
	DT         float64   `json:"dt"`
	Ticks      int       `json:"ticks"`
	SampleEach int       `json:"sampleEach"`
	Cases      []carCase `json:"cases"`
}

// Car returns car.json.
func Car() []byte {
	r := &rng{s: 0x70171a4e}
	f := carFile{DT: car.DT, Ticks: carTicks, SampleEach: sampleEach}
	for i := 0; i < carCases; i++ {
		f.Cases = append(f.Cases, makeCarCase(r, i))
	}
	for i, sc := range scripts() {
		f.Cases = append(f.Cases, scriptedCase(carCases+i, sc))
	}
	return marshal(f)
}

// seg is a scripted stretch of input: n ticks of th, br, st, rv (wire units).
type seg struct {
	n              int
	th, br, st, rv int8
}

type script struct {
	h    car.Handling
	tc   int
	abs  int
	vx   float64 // initial forward speed
	segs []seg
}

// scripts are the TC, reverse and launch cases (40..48), each 600 ticks.
func scripts() []script {
	flick := []seg{{90, 100, 0, 127, 0}, {60, 100, 0, 0, 0}, {90, 100, 0, -127, 0}, {360, 100, 0, 0, 0}}
	return []script{
		{car.Sim, 1, 1, 30, flick}, // 40..42: Sim TC 1..3, full throttle through a flick
		{car.Sim, 2, 2, 30, flick},
		{car.Sim, 3, 3, 30, flick},
		{car.Arcade, 0, 0, 30, flick}, // 43: Arcade acts as TC 3 whatever the setting
		// 44: Sim reverse from rest, steering while backing up, then forward again.
		{car.Sim, 2, 0, 0, []seg{{120, 100, 0, 0, 1}, {120, 100, 0, 127, 1}, {60, 0, 0, 0, 0}, {180, 100, 0, 0, 0}, {120, 0, 100, 0, 0}}},
		// 45: Arcade reverse selected while rolling forward (brakes), then backs up and stops.
		{car.Arcade, 2, 2, 15, []seg{{200, 100, 0, 0, 1}, {100, 100, 0, -90, 1}, {120, 0, 100, 0, 0}, {180, 60, 0, 0, 0}}},
		// 46: Sim TC 2 launch: hold, release, steer, brake.
		{car.Sim, 2, 3, 0, []seg{{120, 100, 100, 0, 0}, {240, 100, 0, 0, 0}, {120, 100, 0, 50, 0}, {120, 0, 100, 0, 0}}},
		// 47: Arcade launch on part throttle, then brake and throttle at speed down to a new hold.
		{car.Arcade, 2, 1, 0, []seg{{150, 50, 60, 0, 0}, {200, 100, 0, 0, 0}, {250, 100, 100, 0, 0}}},
		// 48: Sim reverse with the brake held at rest (held still), released (backs up), braked while backing up, held again.
		{car.Sim, 1, 0, 0, []seg{{120, 100, 100, 0, 1}, {150, 100, 0, 0, 1}, {120, 100, 100, 0, 1}, {210, 0, 0, 0, 0}}},
	}
}

func scriptedCase(i int, sc script) carCase {
	s := car.DefaultSetup()
	s[car.TC] = sc.tc
	s[car.ABS] = sc.abs
	p := car.NewParams(sc.h, s, car.Damage{})
	a := 0.3 * float64(i-carCases)
	st := car.State{X: float64(10 * i), Z: -20, H: a, HX: math.Cos(a), HZ: math.Sin(a), VX: sc.vx, RPM: 4000, Gear: 1}
	c := carCase{Handling: sc.h.String(), Setup: s, Params: p, Init: st, Env: []envSeg{{Mu: 1}}}
	for _, g := range sc.segs {
		for k := 0; k < g.n; k++ {
			c.Inputs = append(c.Inputs, [4]int8{g.th, g.br, g.st, g.rv})
		}
	}
	if len(c.Inputs) != carTicks {
		panic(fmt.Sprintf("vectors: script %d has %d ticks", i, len(c.Inputs)))
	}
	c.play(st, p)
	return c
}

func makeCarCase(r *rng, i int) carCase {
	h := car.Arcade
	if i%2 == 1 {
		h = car.Sim
	}
	// TC cycles 0..3 over pairs of cases and ABS over runs of eight, both
	// without drawing from r, so the other setup values replay as before.
	s := car.Setup{r.rangeI(1, 11), r.rangeI(1, 11), r.rangeI(50, 70), r.rangeI(1, 5), r.rangeI(1, 10), r.rangeI(1, 9), i / 2 % 4, i / 8 % 4}
	var d car.Damage
	switch {
	case i >= 38: // front wing lost
		d = car.Damage{FrontWing: r.rangeF(0.61, 1), RearWing: r.rangeF(0, 0.5), Susp: r.rangeF(0, 0.5)}
	case i >= 34: // partial damage, wing kept
		d = car.Damage{FrontWing: r.rangeF(0, 0.6), RearWing: r.rangeF(0, 1), Susp: r.rangeF(0, 1)}
	}
	p := car.NewParams(h, s, d)
	a := r.rangeF(0, 2*math.Pi)
	st := car.State{X: r.rangeF(-500, 500), Z: r.rangeF(-500, 500), H: a, HX: math.Cos(a), HZ: math.Sin(a),
		RPM: 4000, Gear: 1, Dmg: d}
	if i%4 >= 2 { // half the cases start rolling
		st.VX = r.rangeF(5, 70)
	}
	c := carCase{Handling: h.String(), Setup: s, Dmg: d, Params: p, Init: st}
	for t := 0; t < carTicks; {
		n := min(r.rangeI(10, 60), carTicks-t)
		in := [4]int8{int8(r.rangeI(40, 100)), 0, int8(r.rangeI(-127, 127)), 0}
		if r.float() < 0.3 {
			in[0], in[1] = int8(r.rangeI(0, 30)), int8(r.rangeI(30, 100))
		}
		if r.float() < 0.3 {
			in[2] = 0
		}
		for k := 0; k < n; k++ {
			c.Inputs = append(c.Inputs, in)
		}
		t += n
	}
	surfaces := []envSeg{{Mu: 1}, {Mu: 0.9}, {Mu: 0.55, Drag: 0.9}}
	for t := 0; t < carTicks; t += r.rangeI(60, 200) {
		sf := surfaces[0]
		if r.float() < 0.4 {
			sf = surfaces[r.rangeI(1, 2)]
		}
		sf.T = t
		c.Env = append(c.Env, sf)
	}
	c.play(st, p)
	return c
}

// play steps st through c's inputs and environment, sampling every sampleEach ticks.
func (c *carCase) play(st car.State, p car.Params) {
	e := 0
	for t := 0; t < carTicks; t++ {
		for e+1 < len(c.Env) && c.Env[e+1].T <= t {
			e++
		}
		w := c.Inputs[t]
		in := protocol.Input{Th: w[0], Br: w[1], St: w[2], Rv: w[3] == 1}
		car.Step(&st, &p, in.Car(), car.Env{Mu: c.Env[e].Mu, Drag: c.Env[e].Drag})
		if (t+1)%sampleEach == 0 {
			c.States = append(c.States, st)
		}
	}
}

type trackCase struct {
	S      float64 `json:"s"`
	Lat    float64 `json:"lat"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	I      int     `json:"i"`
	LocLat float64 `json:"locLat"`
	LocS   float64 `json:"locS"`
}

type trackFile struct {
	Length float64     `json:"length"`
	Cases  []trackCase `json:"cases"`
}

// Track returns track.json for the circuit as construction builds it on this machine.
func Track() []byte { return TrackOf(track.Kiyi()) }

// TrackFromKiyi returns track.json for the circuit a kiyi.json file describes. Queries are
// bit-portable but construction is not, so this is the architecture-independent route.
func TrackFromKiyi(kiyiJSON []byte) ([]byte, error) {
	var f kiyiFile
	if err := json.Unmarshal(kiyiJSON, &f); err != nil {
		return nil, err
	}
	tr := &track.Track{ID: f.ID, Width: f.Width, Kerb: f.Kerb, Runoff: f.Runoff, Length: f.Length,
		Sectors: f.Sectors, Line: f.Line}
	for _, s := range f.Segs {
		tr.Segs = append(tr.Segs, track.Seg{X: s[0], Z: s[1], TX: s[2], TZ: s[3], NX: s[4], NZ: s[5], S: s[6], K: s[7]})
	}
	return TrackOf(tr), nil
}

// TrackOf returns track.json: Point(s, lat) and Locate(x, z, -1) of the result.
func TrackOf(tr *track.Track) []byte {
	r := &rng{s: 0x7a4c0de}
	f := trackFile{Length: tr.Length}
	for i := 0; i < trackCases; i++ {
		c := trackCase{S: r.rangeF(0, tr.Length), Lat: r.rangeF(-tr.WallLat(), tr.WallLat())}
		c.X, c.Z = tr.Point(c.S, c.Lat)
		c.I, c.LocLat, c.LocS = tr.Locate(c.X, c.Z, -1)
		f.Cases = append(f.Cases, c)
	}
	return marshal(f)
}

type kiyiFile struct {
	ID      string         `json:"id"`
	Width   float64        `json:"width"`
	Kerb    float64        `json:"kerb"`
	Runoff  float64        `json:"runoff"`
	Length  float64        `json:"length"`
	Sectors [3]float64     `json:"sectors"`
	Grid    [10][3]float64 `json:"grid"`
	Segs    [][8]float64   `json:"segs"`
	Line    []float64      `json:"line"`
}

// Kiyi returns kiyi.json, the sampled circuit the client loads.
func Kiyi() []byte {
	tr := track.Kiyi()
	f := kiyiFile{ID: tr.ID, Width: tr.Width, Kerb: tr.Kerb, Runoff: tr.Runoff, Length: tr.Length,
		Sectors: tr.Sectors, Line: tr.Line}
	for i, g := range tr.Grid {
		f.Grid[i] = [3]float64{g.X, g.Z, g.H}
	}
	for _, s := range tr.Segs {
		f.Segs = append(f.Segs, [8]float64{s.X, s.Z, s.TX, s.TZ, s.NX, s.NZ, s.S, s.K})
	}
	return marshal(f)
}

func marshal(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return append(b, '\n')
}
