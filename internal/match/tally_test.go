package match

import (
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/roomkit/room"
)

type sink struct{ got []stats.Delta }

func (s *sink) Record(d stats.Delta) bool { s.got = append(s.got, d); return true }

func newCounted(s StatsSink) *Match {
	return New(race.Settings{Handling: car.Arcade, Contact: race.Soft, Laps: 3, Listed: true, Seed: 7}, s)
}

func joinPilot(t *testing.T, m *Match, out *fakeOut, name, hash string) room.PlayerID {
	t.Helper()
	id, err := m.Join(room.Who{Name: name, Pilot: hash})
	if err != nil {
		t.Fatal(err)
	}
	out.players = append(out.players, id)
	m.Welcome(id, "ABCD", "", out)
	return id
}

func toResults(m *Match, out *fakeOut) {
	run(m, out, 600*60, func() bool { return m.r.Phase() == race.Results })
}

func rowOf(m *Match, id room.PlayerID) protocol.ResultRowMsg {
	for _, r := range m.results.Rows {
		if r.ID == uint8(id) {
			return r
		}
	}
	return protocol.ResultRowMsg{}
}

func TestResultsRecordSeatedPilotsOnly(t *testing.T) {
	sk := &sink{}
	m, out := newCounted(sk), &fakeOut{}
	a := joinPilot(t, m, out, "Ace", "hashA")
	joinPilot(t, m, out, "Anon", "") // no token: not counted
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	toResults(m, out)
	if len(sk.got) != 1 {
		t.Fatalf("one pilot, one record, bots never: %+v", sk.got)
	}
	d, row := sk.got[0], rowOf(m, a)
	if d.Pilot != "hashA" || d.Name != "Ace" || d.Races != 1 || d.Laps != row.Laps ||
		(d.Wins == 1) != (row.Pos == 1) || (d.Podiums == 1) != (row.Pos <= 3) || d.Week != "" {
		t.Fatalf("%+v vs %+v", d, row)
	}
	if row.Best > 0 && d.BestMs["kiyi"] != row.Best || row.Best == 0 && d.BestMs != nil {
		t.Fatalf("best %v vs %d", d.BestMs, row.Best)
	}
}

func TestWinAndPodiumByPosition(t *testing.T) {
	for _, c := range []struct {
		pos           int
		wins, podiums int
	}{{1, 1, 1}, {3, 0, 1}, {4, 0, 0}} {
		sk := &sink{}
		m := newCounted(sk)
		m.record([]race.ResultRow{{Pos: c.pos, Human: true, Pilot: "h", Name: "A", Laps: 3, BestMs: 80000}, {Pos: 9, Pilot: "bot"}})
		if len(sk.got) != 1 || sk.got[0].Wins != c.wins || sk.got[0].Podiums != c.podiums || sk.got[0].Laps != 3 ||
			sk.got[0].BestMs["kiyi"] != 80000 {
			t.Fatalf("pos %d: %+v", c.pos, sk.got)
		}
	}
}

func TestBotRowsAndPilotlessNeverRecorded(t *testing.T) {
	sk := &sink{}
	m := newCounted(sk)
	m.record([]race.ResultRow{{Pos: 1, Human: false, Pilot: "ghost"}, {Pos: 2, Human: true, Pilot: ""}})
	if len(sk.got) != 0 {
		t.Fatalf("%+v", sk.got)
	}
}

func TestLeavingMidRaceRecordsNothing(t *testing.T) {
	sk := &sink{}
	m, out := newCounted(sk), &fakeOut{}
	a := joinPilot(t, m, out, "Ace", "hashA")
	b := joinPilot(t, m, out, "Bee", "hashB")
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Racing })
	m.Leave(b)
	toResults(m, out)
	if len(sk.got) != 1 || sk.got[0].Pilot != "hashA" {
		t.Fatalf("only the pilot who stayed: %+v", sk.got)
	}
}

func TestNilSinkIsFine(t *testing.T) {
	m := newCounted(nil)
	m.record([]race.ResultRow{{Pos: 1, Human: true, Pilot: "h"}})
	m.FlushStats()
	m.Close()
}
