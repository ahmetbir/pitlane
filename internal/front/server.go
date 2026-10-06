package front

import (
	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/roomkit/server"
)

// Server is the generic server instantiated for Pitlane.
type Server = server.Server[race.Settings, protocol.ClientMsg, protocol.Input, match.Info]

// NewServer is Pitlane's HTTP handler.
func NewServer(l *match.Lobby, o server.Options) *Server { return server.New(l, Kit{}, o) }
