package main

import (
	"fmt"
	"math"

	"github.com/ahmetbir/pitlane/internal/protocol"
)

// inputHz is the client's input rate (and the room's tick rate).
const inputHz = 60

// defaultSetup is the garage's default set-up, sent on the welcome.
var defaultSetup = protocol.SetupInts{6, 6, 58, 3, 5, 5}

// driver is the load test's Pitlane player: hello, the create message from
// the flags, ready on the welcome and a weaving steer at full throttle.
type driver struct{ create protocol.ClientMsg }

func (d driver) Hello(i int) any {
	return protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: fmt.Sprintf("lt%d", i)}
}
func (d driver) Create() any { return d.create }

// Input: full throttle, steer 60·sin(seq/90).
func (driver) Input(_ int, seq uint32) any {
	return protocol.ClientMsg{T: protocol.TIn, Seq: seq, Th: 100, St: int(60 * math.Sin(float64(seq)/90))}
}

func (driver) React(_, _ int, t string, _ []byte) any {
	if t != "welcome" {
		return nil
	}
	s := defaultSetup
	return protocol.ClientMsg{T: protocol.TReady, Setup: &s}
}
