// Package front is Pitlane's server.Kit: decoding, create and quick-play
// settings, the in-room message whitelist and /api/rooms rows.
package front

import (
	"time"

	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/roomkit/room"
	"github.com/ahmetbir/roomkit/server"
)

type Kit struct{}

var _ server.Kit[race.Settings, protocol.ClientMsg, match.Info] = Kit{}

func (Kit) Version() int                                { return protocol.Version }
func (Kit) Decode(b []byte) (protocol.ClientMsg, error) { return protocol.DecodeClient(b) }
func (Kit) Settings(m protocol.ClientMsg, now time.Time) (race.Settings, bool) {
	return settings(m, now)
}
func (Kit) QuickSettings(now time.Time) race.Settings { return quickSettings(now) }

// Class: ready and start are choices (a refusal kicks), the rest share one bucket.
func (Kit) Class(t string) server.Class {
	if t == protocol.TReady || t == protocol.TStart {
		return server.ClassChoice
	}
	return server.ClassAll
}

// InRoom: ready (DecodeClient guarantees its setup) and start.
func (Kit) InRoom(m protocol.ClientMsg) bool { return m.T == protocol.TReady || m.T == protocol.TStart }

type roomJSON struct {
	Code     string `json:"code"`
	Handling string `json:"handling"`
	Contact  string `json:"contact"`
	Laps     int    `json:"laps"`
	Humans   int    `json:"humans"`
	Seats    int    `json:"seats"`
	Phase    string `json:"phase"`
	Lap      int    `json:"lap"`
}

func (Kit) Row(x room.Summary[match.Info]) any {
	g := x.Game
	return roomJSON{x.Code, g.Handling, g.Contact, g.Laps, x.Humans, x.Seats, g.Phase, g.Lap}
}
