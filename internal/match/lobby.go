package match

import (
	"context"

	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/roomkit/lobby"
	"github.com/ahmetbir/roomkit/metrics"
	"github.com/ahmetbir/roomkit/room"
)

// NewLobby is Pitlane's lobby: rooms build a Match recording into sink
// (nil = not counted) and relay the protocol's chat presets.
func NewLobby(ctx context.Context, maxRooms int, reg *metrics.Registry, sink StatsSink) *Lobby {
	return lobby.New(ctx, lobby.Options[race.Settings, protocol.ClientMsg, protocol.Input, Info]{
		MaxRooms: maxRooms, Metrics: reg,
		Room: room.Options{ChatMax: protocol.ChatMax},
		New: func(s race.Settings) (room.Game[protocol.ClientMsg, protocol.Input, Info], error) {
			return New(s, sink), nil
		},
	})
}
