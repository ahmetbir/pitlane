// Package protocol defines Pitlane's JSON wire messages (version 2): flat
// objects with a "t" type, the roomkit envelope plus game fields.
package protocol

import "github.com/ahmetbir/roomkit/netproto"

// The "notice", "error", "pong" and "chat" shapes are roomkit's: see
// github.com/ahmetbir/roomkit/netproto.

// Version is the wire protocol version a hello must carry.
const Version = 2

// MaxClientMsg is the largest client message DecodeClient accepts.
const MaxClientMsg = 1024

// Client message types: the core's, plus Pitlane's ready and start.
const (
	THello  = netproto.THello
	TCreate = netproto.TCreate
	TJoin   = netproto.TJoin
	TQuick  = netproto.TQuick
	TIn     = netproto.TIn
	TPing   = netproto.TPing
	TChat   = netproto.TChat
	TReady  = "ready"
	TStart  = "start"
)

// Server message types of Pitlane (the core's are netproto's).
const (
	TSnap    = "snap"
	TGrid    = "grid"
	TLights  = "lights"
	TLap     = "lap"
	TResults = "results"
	TWing    = "wing"
	TReset   = "reset"
	TDmg     = "dmg"
)

// ChatMax is the highest quick chat preset ID (presets are 1..ChatMax).
const ChatMax = 6

// Room setting values.
const (
	HandlingArcade = "arcade"
	HandlingSim    = "sim"
	ContactGhost   = "ghost"
	ContactSoft    = "soft"
	ContactFull    = "full"
)

// Snapshot phases.
const (
	PhaseGrid    = "grid"
	PhaseLights  = "lights"
	PhaseRacing  = "racing"
	PhaseFinish  = "finish"
	PhaseResults = "results"
)

// Stable codes. The client shows its own text per code; Msg stays the
// server's text. The error and API codes every game shares are netproto's.
const (
	// "notice" messages.
	CodeNotCreator = "not_creator" // start by a non-creator
	CodeNotGrid    = "not_grid"    // ready/start outside the grid phase

	// Refusals of a join/quick (sent as an "error" message).
	CodeRacing = "racing" // takeover refused: no bot car left
)

// NoticeCodes are the codes a "notice" message may carry, in the client's order.
func NoticeCodes() []string { return []string{CodeNotCreator, CodeNotGrid} }

// RefusalCodes are Pitlane's own "error" codes (a refused seat).
func RefusalCodes() []string { return []string{CodeRacing} }
