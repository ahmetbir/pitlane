package match

import (
	"testing"

	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/roomkit/room"
)

// drive steps one tick with every listed player on autopilot.
func drive(m *Match, out *fakeOut, ids ...room.PlayerID) {
	in := map[room.PlayerID]protocol.Input{}
	for _, id := range ids {
		in[id] = protocol.WireInput(m.Autopilot(id))
	}
	m.Step(in, out)
}

func carOf(m *Match, id room.PlayerID) *race.Car { return m.r.Cars()[id-1] }

// A pilot who joins during Finish and never drives records nothing, whatever
// the bot did in that car before.
func TestFinishJoinerRecordsNothing(t *testing.T) {
	sk := &sink{}
	m, out := newCounted(sk), &fakeOut{}
	run(m, out, 600*60, func() bool { return m.r.Phase() == race.Finish })
	joinPilot(t, m, out, "Late", "hashL")
	toResults(m, out)
	if m.r.Phase() != race.Results || len(sk.got) != 0 {
		t.Fatalf("phase %v recorded %+v", m.r.Phase(), sk.got)
	}
}

// A pilot who takes over at lap 2 of 3 and finishes: the race counts, with
// the laps completed since the takeover and the best of the laps started since.
func TestMidRaceJoinerCreditedFromTakeover(t *testing.T) {
	sk := &sink{}
	m, out := newCounted(sk), &fakeOut{}
	run(m, out, 600*60, func() bool {
		if m.r.Phase() != race.Racing {
			return false
		}
		for _, c := range m.r.Cars() {
			if c.Lap < 1 {
				return false
			}
		}
		return true
	})
	id := joinPilot(t, m, out, "Late", "hashL")
	c := carOf(m, id)
	from := c.Lap
	out.take()
	own := 0
	for i := 0; i < 600*60 && m.r.Phase() != race.Results; i++ {
		drive(m, out, id)
		for _, l := range of[protocol.LapMsg](out.take()) {
			if l.Car == uint8(id) && l.Lap > from+1 && l.Valid && (own == 0 || l.Ms < own) {
				own = l.Ms
			}
		}
	}
	if !c.Finished || own == 0 {
		t.Fatalf("finished %v own best %d", c.Finished, own)
	}
	if len(sk.got) != 1 {
		t.Fatalf("%+v", sk.got)
	}
	d := sk.got[0]
	if d.Pilot != "hashL" || d.Races != 1 || d.Laps != c.Lap-from || d.BestMs["kiyi-arcade"] != own || len(d.BestMs) != 1 {
		t.Fatalf("from lap %d to %d, own best %d: %+v", from, c.Lap, own, d)
	}
}

// A finish is recorded at the flag: the pilot may leave during the Finish
// window, and Results does not record them again.
func TestFinishThenLeaveRecordedOnce(t *testing.T) {
	sk := &sink{}
	m, out := newCounted(sk), &fakeOut{}
	a := joinPilot(t, m, out, "Ace", "hashA")
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	c := carOf(m, a)
	for i := 0; i < 600*60 && !c.Finished; i++ {
		drive(m, out, a)
	}
	if !c.Finished || c.Pos != 1 || m.r.Phase() != race.Finish {
		t.Fatalf("finished %v P%d phase %v", c.Finished, c.Pos, m.r.Phase())
	}
	if len(sk.got) != 1 {
		t.Fatalf("not recorded at the flag: %+v", sk.got)
	}
	m.Leave(a)
	toResults(m, out)
	if m.r.Phase() != race.Results || len(sk.got) != 1 {
		t.Fatalf("phase %v recorded %+v", m.r.Phase(), sk.got)
	}
	if d := sk.got[0]; d.Pilot != "hashA" || d.Races != 1 || d.Wins != 1 || d.Podiums != 1 || d.Laps != 3 || d.BestMs["kiyi-arcade"] == 0 {
		t.Fatalf("%+v", d)
	}
}

// A pilot who reconnects mid-race gets their car, place and lap back, and the
// race counts as if they had never left.
func TestReconnectKeepsCarAndRace(t *testing.T) {
	sk := &sink{}
	m, out := newCounted(sk), &fakeOut{}
	a := joinPilot(t, m, out, "Ace", "hashA")
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	c := carOf(m, a)
	for i := 0; i < 600*60 && (m.r.Phase() != race.Racing || c.Lap < 1); i++ {
		drive(m, out, a)
	}
	pos, lap := c.Pos, c.Lap
	if pos != 1 {
		t.Fatalf("P%d", pos)
	}
	m.Leave(a)
	m.Step(nil, out)
	b, err := m.Join(room.Who{Name: "Ace", Pilot: "hashA"})
	if err != nil || b != a || c.Pos != pos || c.Lap != lap {
		t.Fatalf("car %d (was %d) P%d lap %d err %v", b, a, c.Pos, c.Lap, err)
	}
	for i := 0; i < 600*60 && m.r.Phase() != race.Results; i++ {
		drive(m, out, b)
	}
	if len(sk.got) != 1 || sk.got[0].Races != 1 || sk.got[0].Laps != 3 {
		t.Fatalf("%+v", sk.got)
	}
}
