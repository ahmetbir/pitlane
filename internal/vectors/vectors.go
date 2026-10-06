// Package vectors builds the Go-written test vectors the TypeScript port
// replays: car cases (setup, damage, inputs, sampled states), track cases
// (Point and Locate) and the sampled Kiyi circuit the client loads. Floats
// are written with encoding/json, which round-trips every float64 exactly.
package vectors

import (
	"encoding/json"
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/track"
)

const (
	carCases   = 40
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
	Inputs   [][3]int8   `json:"inputs"` // wire units: th/100, br/100, st/127, one per tick
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
	return marshal(f)
}

func makeCarCase(r *rng, i int) carCase {
	h := car.Arcade
	if i%2 == 1 {
		h = car.Sim
	}
	s := car.Setup{r.rangeI(1, 11), r.rangeI(1, 11), r.rangeI(50, 70), r.rangeI(1, 5), r.rangeI(1, 10), r.rangeI(1, 9)}
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
		in := [3]int8{int8(r.rangeI(40, 100)), 0, int8(r.rangeI(-127, 127))}
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
	e := 0
	for t := 0; t < carTicks; t++ {
		for e+1 < len(c.Env) && c.Env[e+1].T <= t {
			e++
		}
		in := protocol.Input{Th: c.Inputs[t][0], Br: c.Inputs[t][1], St: c.Inputs[t][2]}
		car.Step(&st, &p, in.Car(), car.Env{Mu: c.Env[e].Mu, Drag: c.Env[e].Drag})
		if (t+1)%sampleEach == 0 {
			c.States = append(c.States, st)
		}
	}
	return c
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
