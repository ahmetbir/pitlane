package front

import (
	"time"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
)

// quickSettings is the room quick play makes when none is free.
func quickSettings(now time.Time) race.Settings {
	return race.Settings{Handling: car.Arcade, Contact: race.Soft, Laps: 3, Listed: true, Seed: seed(now)}
}

// settings builds room settings from a create message. Missing fields take
// arcade, soft, 3 laps, listed; any other value is refused.
func settings(m protocol.ClientMsg, now time.Time) (race.Settings, bool) {
	h, ok1 := car.ParseHandling(orDefault(m.Handling, protocol.HandlingArcade))
	c, ok2 := race.ParseContact(orDefault(m.Contact, protocol.ContactSoft))
	laps := m.Laps
	if laps == 0 {
		laps = 3
	}
	ok3 := laps == 3 || laps == 5 || laps == 8
	listed := m.Listed == nil || *m.Listed
	return race.Settings{Handling: h, Contact: c, Laps: laps, Listed: listed, Seed: seed(now)}, ok1 && ok2 && ok3
}

func orDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func seed(now time.Time) uint64 { return uint64(now.UnixNano()) }
