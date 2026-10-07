package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/roomkit/netproto"
)

// ClientMsg is every client→server message; T selects which fields matter.
type ClientMsg struct {
	T    string  `json:"t"`              // hello|create|join|quick|ready|start|in|ping|chat
	V    int     `json:"v,omitempty"`    // hello
	Name string  `json:"name,omitempty"` // hello
	Tok  string  `json:"tok,omitempty"`  // hello: pilot token
	Code string  `json:"code,omitempty"` // join
	Seq  uint32  `json:"seq,omitempty"`  // in; starts at 1
	TS   float64 `json:"ts,omitempty"`   // ping
	Chat int     `json:"id,omitempty"`   // chat: preset 1..ChatMax

	Handling string `json:"handling,omitempty"` // create: arcade|sim
	Contact  string `json:"contact,omitempty"`  // create: ghost|soft|full
	Laps     int    `json:"laps,omitempty"`     // create: 3|5|8
	Listed   *bool  `json:"listed,omitempty"`   // create

	Th int       `json:"th,omitempty"` // in: throttle 0..100
	Br int       `json:"br,omitempty"` // in: brake 0..100
	St int       `json:"st,omitempty"` // in: steer -127..127 (left +)
	Rv bool      `json:"rv,omitempty"` // in: reverse gear selected (the throttle drives it)
	Lv *LiveInts `json:"lv,omitempty"` // in: live setup [bb, diff, tc, abs] (car.Live), clamped; omitted = no change

	Setup *SetupInts `json:"setup,omitempty"` // ready: exactly 8 integers [fw, rw, bb, gear, diff, susp, tc, abs]
}

// SetupInts is the wire setup: exactly eight integers.
type SetupInts [8]int

// UnmarshalJSON accepts only an array of exactly eight integers.
func (s *SetupInts) UnmarshalJSON(b []byte) error { return decodeInts(b, s[:]) }

// LiveInts is the wire live setup: exactly four integers in car.Live order.
type LiveInts [4]int

// UnmarshalJSON accepts only an array of exactly four integers.
func (l *LiveInts) UnmarshalJSON(b []byte) error { return decodeInts(b, l[:]) }

// decodeInts fills dst from a JSON array of exactly len(dst) integers; dst is
// left as it was on an error.
func decodeInts(b []byte, dst []int) error {
	var n []json.RawMessage
	if err := json.Unmarshal(b, &n); err != nil || len(n) != len(dst) {
		return ErrBadField
	}
	out := make([]int, len(dst))
	for i, v := range n {
		x, err := strconv.ParseInt(string(v), 10, 32)
		if err != nil {
			return ErrBadField
		}
		out[i] = int(x)
	}
	copy(dst, out)
	return nil
}

var (
	ErrTooBig      = errors.New("protocol: message too big")
	ErrUnknownType = errors.New("protocol: unknown message type")
	ErrBadField    = errors.New("protocol: bad field value")
)

// DecodeClient parses one client message. It rejects oversized messages,
// unknown types, non-finite numbers (netproto.CheckHeader), chat IDs outside
// 1..ChatMax and create settings outside their sets; th/br/st and lv are clamped.
func DecodeClient(b []byte) (ClientMsg, error) {
	var m ClientMsg
	if len(b) > MaxClientMsg {
		return m, ErrTooBig
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return ClientMsg{}, fmt.Errorf("protocol: %w", err)
	}
	switch m.T {
	case THello, TCreate, TJoin, TQuick, TIn, TPing, TChat, TReady, TStart:
	default:
		return ClientMsg{}, ErrUnknownType
	}
	if err := netproto.CheckHeader(m.Head(), ChatMax); err != nil {
		return ClientMsg{}, err
	}
	if m.T == TCreate && !validCreate(m) || m.T == TReady && m.Setup == nil {
		return ClientMsg{}, ErrBadField
	}
	m.Th, m.Br, m.St = clamp(m.Th, 0, 100), clamp(m.Br, 0, 100), clamp(m.St, -127, 127)
	if m.Lv != nil {
		lv := clampLive(*m.Lv)
		m.Lv = &lv
	}
	return m, nil
}

func validCreate(m ClientMsg) bool {
	switch m.Handling {
	case "", HandlingArcade, HandlingSim:
	default:
		return false
	}
	switch m.Contact {
	case "", ContactGhost, ContactSoft, ContactFull:
	default:
		return false
	}
	switch m.Laps {
	case 0, 3, 5, 8:
	default:
		return false
	}
	return true
}

func clamp(v, lo, hi int) int { return min(max(v, lo), hi) }

// clampLive clamps live values to their setup ranges (car.Setup.Clamp).
func clampLive(lv LiveInts) LiveInts { return car.DefaultSetup().WithLive(lv).LiveValues() }

// Head is the part of m the core reads.
func (m ClientMsg) Head() netproto.Header {
	return netproto.Header{T: m.T, V: m.V, Name: m.Name, Tok: m.Tok, Code: m.Code, Seq: m.Seq, TS: m.TS, Chat: m.Chat}
}

// Input is the wire input of one tick. Pitlane has no one-shot presses; the
// live setup values (Lv, when HasLv) are absolute, so an input that carries
// none takes those of an older one dropped in its favour, and a held input
// repeats them harmlessly.
type Input struct {
	Th, Br, St int8
	Rv         bool
	Lv         [4]int8 // live setup in car.Live order, clamped
	HasLv      bool
}

func (in Input) Latch(dropped Input) Input {
	if !in.HasLv {
		in.Lv, in.HasLv = dropped.Lv, dropped.HasLv
	}
	return in
}
func (in Input) Held() Input { return in }

// Live returns the live setup values (car.Live order) and whether the input carries them.
func (in Input) Live() (lv [4]int, ok bool) {
	for i, v := range in.Lv {
		lv[i] = int(v)
	}
	return lv, in.HasLv
}

// Car converts to the car model's input: th/100, br/100, st/127, rv.
func (in Input) Car() car.Input {
	return car.Input{Throttle: float64(in.Th) / 100, Brake: float64(in.Br) / 100, Steer: float64(in.St) / 127, Reverse: in.Rv}
}

// WireInput quantises a car input to the wire's units (th/100, br/100, st/127, rv), as a
// client does before sending it.
func WireInput(in car.Input) Input {
	in = in.Clean()
	return Input{Th: int8(math.Round(in.Throttle * 100)), Br: int8(math.Round(in.Brake * 100)), St: int8(math.Round(in.Steer * 127)), Rv: in.Reverse}
}

// Input converts an "in" message to a clamped input (also when m was not
// built by DecodeClient).
func (m ClientMsg) Input() Input {
	in := Input{Th: int8(clamp(m.Th, 0, 100)), Br: int8(clamp(m.Br, 0, 100)), St: int8(clamp(m.St, -127, 127)), Rv: m.Rv}
	if m.Lv != nil {
		for i, v := range clampLive(*m.Lv) {
			in.Lv[i] = int8(v)
		}
		in.HasLv = true
	}
	return in
}

// Latch returns m: Pitlane inputs have no one-shot presses to carry over.
func (m ClientMsg) Latch(ClientMsg) ClientMsg { return m }
