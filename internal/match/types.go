package match

import (
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/roomkit/lobby"
	"github.com/ahmetbir/roomkit/room"
)

// Info is Pitlane's part of the lobby summary (a value type).
type Info struct {
	Handling, Contact string
	Laps              int
	Phase             string // grid|lights|racing|finish|results
	Lap               int    // the leader's lap
}

// The generic core types instantiated for Pitlane.
type (
	Room    = room.Room[protocol.ClientMsg, protocol.Input, Info]
	Lobby   = lobby.Lobby[race.Settings, protocol.ClientMsg, protocol.Input, Info]
	Summary = room.Summary[Info]
)
