package protocol

import (
	"math"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/track"
	"github.com/ahmetbir/roomkit/netproto"
)

// Pitlane's server messages. Examples are one JSON line each (the TS client
// is written from these; field names are fixed by wire v1).

// NewWelcome builds the welcome of a player; tok is set only when a pilot
// token was just issued. setup and dmg are the seated car's current ones.
func NewWelcome(you netproto.PlayerID, code, tok string, carID uint8, handling, contact string, laps int, trackName string, creator bool,
	setup car.Setup, dmg car.Damage) Welcome {
	return Welcome{
		Welcome: netproto.Welcome{T: netproto.TWelcome, You: you, Code: code, Tok: tok},
		Car:     carID, Handling: handling, Contact: contact, Laps: laps, Track: trackName, Creator: creator,
		Setup: SetupInts(setup), Dmg: EncodeDamage(dmg),
	}
}

// Welcome seats a player: the roomkit envelope (t, you, code, tok) flat
// beside the room settings and the car's current setup and damage (a
// takeover or a reconnect may seat a car that already has both).
//
//	{"t":"welcome","you":7,"code":"K3FQ","car":4,"handling":"arcade","contact":"soft","laps":5,"track":"kiyi","creator":true,"setup":[6,6,58,3,5,5],"dmg":{"fw":0,"rw":0,"su":0}}
//
// tok appears only when a pilot token was just issued.
type Welcome struct {
	netproto.Welcome
	Car      uint8      `json:"car"`      // your car id 1..10
	Handling string     `json:"handling"` // arcade|sim
	Contact  string     `json:"contact"`  // ghost|soft|full
	Laps     int        `json:"laps"`
	Track    string     `json:"track"`
	Creator  bool       `json:"creator"` // may press start
	Setup    SetupInts  `json:"setup"`   // the car's setup [fw, rw, bb, gear, diff, susp]
	Dmg      DamageInts `json:"dmg"`     // the car's damage
}

// DamageInts is a car's damage on the wire: each part ×1000 (0 intact … 1000 broken).
type DamageInts struct {
	FW int `json:"fw"` // front wing
	RW int `json:"rw"` // rear wing
	SU int `json:"su"` // suspension
}

// EncodeDamage quantises d to the wire (parts outside 0..1 saturate, NaN is 0).
func EncodeDamage(d car.Damage) DamageInts {
	p := func(v float64) int { return int(q(math.Min(math.Max(v, 0), 1), 1000)) }
	return DamageInts{FW: p(d.FrontWing), RW: p(d.RearWing), SU: p(d.Susp)}
}

// DmgMsg: a car's damage changed (contact, wall, or repaired on the grid);
// not evictable. Sent to everyone; the owner's client rebuilds its model.
//
//	{"t":"dmg","car":3,"fw":420,"rw":0,"su":75}
type DmgMsg struct {
	T   string `json:"t"` // "dmg"
	Car uint8  `json:"car"`
	DamageInts
}

// NewDmg builds the damage message of a car.
func NewDmg(id race.CarID, d DamageInts) DmgMsg {
	return DmgMsg{T: TDmg, Car: uint8(id), DamageInts: d}
}

// Snap is the 30 Hz state; evictable. cars rows are
// [id, x·100, z·100, h·1000, vx·100, vy·100, r·1000, δ·1000, lap, s·10, flags]
// (see EncodeCar). clock is the race clock in ms (0 before the start).
//
//	{"t":"snap","tick":1234,"ack":87,"phase":"racing","clock":41200,"cars":[[1,1234,-560,3142,5500,-12,40,-35,2,18340,0]]}
type Snap struct {
	T     string      `json:"t"`    // "snap"
	Tick  int         `json:"tick"` // game tick
	Ack   uint32      `json:"ack"`  // set per player by the room
	Phase string      `json:"phase"`
	Clock int         `json:"clock"`
	Cars  [][11]int32 `json:"cars"`
}

// Replaceable marks snapshots as superseded by newer ones (wsconn).
func (Snap) Replaceable() {}

// WithAck is s for one player: its input ack set (room.Acker).
func (s Snap) WithAck(ack uint32) any {
	s.Ack = ack
	return s
}

// Car flag bits (the last element of a cars row).
const (
	FlagBot      = 1 << 0
	FlagFinished = 1 << 1
	FlagWingLost = 1 << 2
	FlagOffTrack = 1 << 3
)

// OffTrack reports whether c is beyond the asphalt and its kerb.
func OffTrack(t *track.Track, c *race.Car) bool {
	_, lat, _ := t.Locate(c.St.X, c.St.Z, c.Seg)
	return math.Abs(lat) > t.Width/2+t.Kerb
}

// EncodeCar is one cars row; offTrack comes from OffTrack (kept out so the
// encoder stays pure). Heading is wrapped to (−π, π] before quantising;
// non-finite values encode as 0, out-of-range values saturate.
func EncodeCar(c *race.Car, offTrack bool) [11]int32 {
	var f int32
	if !c.Driver.Human {
		f |= FlagBot
	}
	if c.Finished {
		f |= FlagFinished
	}
	if c.St.Dmg.FrontWingLost() {
		f |= FlagWingLost
	}
	if offTrack {
		f |= FlagOffTrack
	}
	st := c.St
	return [11]int32{
		int32(c.ID), q(st.X, 100), q(st.Z, 100), q(wrap(st.H), 1000),
		q(st.VX, 100), q(st.VY, 100), q(st.R, 1000), q(st.Delta, 1000),
		int32(c.Lap), q(c.S, 10), f,
	}
}

// wrap maps an angle to (−π, π].
func wrap(h float64) float64 {
	if math.IsNaN(h) || math.IsInf(h, 0) {
		return 0
	}
	h = math.Remainder(h, 2*math.Pi)
	if h <= -math.Pi {
		h += 2 * math.Pi
	}
	return h
}

func q(x, scale float64) int32 {
	v := math.Round(x * scale)
	switch {
	case math.IsNaN(v):
		return 0
	case v > math.MaxInt32:
		return math.MaxInt32
	case v < math.MinInt32:
		return math.MinInt32
	}
	return int32(v)
}

// GridCar is one car on the grid screen.
type GridCar struct {
	ID    uint8  `json:"id"`
	Name  string `json:"name"`
	Bot   bool   `json:"bot"`
	Ready bool   `json:"ready"` // setup submitted
}

// GridMsg lists the grid; sent when it changes. Not evictable.
//
//	{"t":"grid","cars":[{"id":1,"name":"Ace","bot":false,"ready":true},{"id":2,"name":"Bot 2","bot":true,"ready":true}],"creator":1}
type GridMsg struct {
	T       string    `json:"t"` // "grid"
	Cars    []GridCar `json:"cars"`
	Creator uint8     `json:"creator"` // car id that may press start, 0 = none
}

// LightsMsg is the start sequence: on lights lit (1..5); on is 0 and out the
// tick at which they went out, sent at lights out. The random hold is never
// announced early.
//
//	{"t":"lights","on":3}
//	{"t":"lights","on":0,"out":2210}
type LightsMsg struct {
	T   string `json:"t"` // "lights"
	On  int    `json:"on"`
	Out int    `json:"out,omitempty"`
}

// LapMsg is a completed lap; not evictable.
//
//	{"t":"lap","car":3,"lap":2,"ms":83412,"valid":true,"best":82950}
type LapMsg struct {
	T     string `json:"t"` // "lap"
	Car   uint8  `json:"car"`
	Lap   int    `json:"lap"`
	Ms    int    `json:"ms"`
	Valid bool   `json:"valid"`
	Best  int    `json:"best"` // the car's best valid lap, 0 = none
}

// NewLap converts a race lap event.
func NewLap(e race.LapEvent) LapMsg {
	return LapMsg{T: TLap, Car: uint8(e.Car), Lap: e.Lap, Ms: e.Ms, Valid: e.Valid, Best: e.Best}
}

// ResultRowMsg is one finishing row.
type ResultRowMsg struct {
	Pos     int    `json:"pos"`
	ID      uint8  `json:"id"`
	Name    string `json:"name"`
	Laps    int    `json:"laps"`
	Total   int    `json:"total"`   // ms, penalties included
	Best    int    `json:"best"`    // ms, 0 = none
	Penalty int    `json:"penalty"` // ms
}

// ResultsMsg ends a race; not evictable.
//
//	{"t":"results","rows":[{"pos":1,"id":4,"name":"Ace","laps":5,"total":421300,"best":83100,"penalty":0}]}
type ResultsMsg struct {
	T    string         `json:"t"` // "results"
	Rows []ResultRowMsg `json:"rows"`
}

// NewResults converts race result rows.
func NewResults(rows []race.ResultRow) ResultsMsg {
	out := make([]ResultRowMsg, 0, len(rows))
	for _, r := range rows {
		out = append(out, ResultRowMsg{Pos: r.Pos, ID: uint8(r.Car), Name: r.Name, Laps: r.Laps,
			Total: r.TotalMs, Best: r.BestMs, Penalty: r.PenaltyMs})
	}
	return ResultsMsg{T: TResults, Rows: out}
}

// WingMsg: a car's front wing came off (full contact); not evictable.
//
//	{"t":"wing","car":3}
type WingMsg struct {
	T   string `json:"t"` // "wing"
	Car uint8  `json:"car"`
}

// NewWing builds the wing-lost event for a car.
func NewWing(id race.CarID) WingMsg { return WingMsg{T: TWing, Car: uint8(id)} }

// ResetMsg: the marshals put a stuck car back on the racing line (it had been below 1 m/s
// for 5 s); not evictable. The snapshots carry its new pose.
//
//	{"t":"reset","car":3}
type ResetMsg struct {
	T   string `json:"t"` // "reset"
	Car uint8  `json:"car"`
}

// NewReset builds the marshal-reset event for a car.
func NewReset(id race.CarID) ResetMsg { return ResetMsg{T: TReset, Car: uint8(id)} }
