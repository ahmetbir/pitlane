package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
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

	Th int `json:"th,omitempty"` // in: throttle 0..100
	Br int `json:"br,omitempty"` // in: brake 0..100
	St int `json:"st,omitempty"` // in: steer -127..127 (left +)

	Setup *SetupInts `json:"setup,omitempty"` // ready: exactly 6 integers [fw, rw, bb, gear, diff, susp]
}

// SetupInts is the wire setup: exactly six integers.
type SetupInts [6]int

// UnmarshalJSON accepts only an array of exactly six integers.
func (s *SetupInts) UnmarshalJSON(b []byte) error {
	var n []json.RawMessage
	if err := json.Unmarshal(b, &n); err != nil || len(n) != len(s) {
		return ErrBadField
	}
	var out SetupInts
	for i, v := range n {
		x, err := strconv.ParseInt(string(v), 10, 32)
		if err != nil {
			return ErrBadField
		}
		out[i] = int(x)
	}
	*s = out
	return nil
}

var (
	ErrTooBig      = errors.New("protocol: message too big")
	ErrUnknownType = errors.New("protocol: unknown message type")
	ErrBadField    = errors.New("protocol: bad field value")
)

// DecodeClient parses one client message. It rejects oversized messages,
// unknown types, non-finite numbers (netproto.CheckHeader), chat IDs outside
// 1..ChatMax and create settings outside their sets; th/br/st are clamped.
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

// Head is the part of m the core reads.
func (m ClientMsg) Head() netproto.Header {
	return netproto.Header{T: m.T, V: m.V, Name: m.Name, Tok: m.Tok, Code: m.Code, Seq: m.Seq, TS: m.TS, Chat: m.Chat}
}

// Input is the wire input of one tick. Pitlane has no one-shot presses, so
// every input is its own latch and its own hold.
type Input struct{ Th, Br, St int8 }

func (in Input) Latch(Input) Input { return in }
func (in Input) Held() Input       { return in }

// Car converts to the car model's input: th/100, br/100, st/127.
func (in Input) Car() car.Input {
	return car.Input{Throttle: float64(in.Th) / 100, Brake: float64(in.Br) / 100, Steer: float64(in.St) / 127}
}

// Input converts an "in" message to a clamped input (also when m was not
// built by DecodeClient).
func (m ClientMsg) Input() Input {
	return Input{Th: int8(clamp(m.Th, 0, 100)), Br: int8(clamp(m.Br, 0, 100)), St: int8(clamp(m.St, -127, 127))}
}

// Latch returns m: Pitlane inputs have no one-shot presses to carry over.
func (m ClientMsg) Latch(ClientMsg) ClientMsg { return m }
