package front

import (
	"testing"
	"time"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/roomkit/room"
	"github.com/ahmetbir/roomkit/server"
)

var now = time.Unix(1_800_000_000, 5)

func TestSettings(t *testing.T) {
	no := false
	for _, c := range []struct {
		name string
		msg  protocol.ClientMsg
		want race.Settings
		ok   bool
	}{
		{"defaults", protocol.ClientMsg{T: "create"}, race.Settings{Handling: car.Arcade, Contact: race.Soft, Laps: 3, Listed: true}, true},
		{"explicit", protocol.ClientMsg{Handling: "sim", Contact: "full", Laps: 8, Listed: &no}, race.Settings{Handling: car.Sim, Contact: race.Full, Laps: 8}, true},
		{"five", protocol.ClientMsg{Laps: 5, Contact: "ghost"}, race.Settings{Handling: car.Arcade, Contact: race.Ghost, Laps: 5, Listed: true}, true},
		{"bad laps", protocol.ClientMsg{Laps: 4}, race.Settings{}, false},
		{"bad handling", protocol.ClientMsg{Handling: "x"}, race.Settings{}, false},
		{"bad contact", protocol.ClientMsg{Contact: "x"}, race.Settings{}, false},
	} {
		got, ok := settings(c.msg, now)
		if ok != c.ok {
			t.Errorf("%s: ok %v", c.name, ok)
			continue
		}
		if !ok {
			continue
		}
		if got.Seed != uint64(now.UnixNano()) {
			t.Errorf("%s: seed %d", c.name, got.Seed)
		}
		got.Seed = 0
		if got != c.want {
			t.Errorf("%s: %+v want %+v", c.name, got, c.want)
		}
	}
}

func TestQuickSettings(t *testing.T) {
	s := Kit{}.QuickSettings(now)
	if s.Handling != car.Arcade || s.Contact != race.Soft || s.Laps != 3 || !s.Listed || s.Seed != uint64(now.UnixNano()) {
		t.Fatalf("%+v", s)
	}
}

func TestKit(t *testing.T) {
	k := Kit{}
	if k.Version() != 2 {
		t.Fatal("version")
	}
	for _, c := range []struct {
		t  string
		cl server.Class
		in bool
	}{
		{protocol.TReady, server.ClassChoice, true},
		{protocol.TStart, server.ClassChoice, true},
		{protocol.TPing, server.ClassAll, false},
		{"nope", server.ClassAll, false},
	} {
		if k.Class(c.t) != c.cl || k.InRoom(protocol.ClientMsg{T: c.t}) != c.in {
			t.Errorf("%s", c.t)
		}
	}
	m, err := k.Decode([]byte(`{"t":"create","laps":5}`))
	if err != nil || m.Laps != 5 {
		t.Fatalf("%+v %v", m, err)
	}
}

func TestRow(t *testing.T) {
	row := Kit{}.Row(room.Summary[match.Info]{Code: "K3FQ",
		Info: room.Info[match.Info]{Humans: 3, Seats: 10, Game: match.Info{Handling: "sim", Contact: "full", Laps: 5, Phase: "racing", Lap: 2}}})
	want := roomJSON{"K3FQ", "sim", "full", 5, 3, 10, "racing", 2}
	if row != any(want) {
		t.Fatalf("%+v", row)
	}
}
