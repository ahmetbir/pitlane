// Package match is Pitlane's room.Game: it wraps race.Race for the room
// actor and encodes the protocol's messages. Every method runs on the room
// goroutine.
package match

import (
	"slices"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/track"
	"github.com/ahmetbir/roomkit/netproto"
	"github.com/ahmetbir/roomkit/room"
)

const (
	// Seats is every car on the grid, bots included.
	Seats = 10
	// SnapEvery is the number of ticks between snapshots (60 Hz → 30 Hz).
	SnapEvery = 2

	tickRate  = 60
	trackName = "kiyi"
)

// StatsSink takes a pilot's tally; it must not block. Task 13 replaces the
// payload type with stats.Delta.
type StatsSink interface{ Record(any) bool }

// Match is not safe for concurrent use; the room goroutine owns it.
type Match struct {
	r         *race.Race
	tr        *track.Track
	set       race.Settings
	stats     StatsSink
	humans    int
	raceStart int // tick of lights out
	grid      []protocol.GridCar
	info      Info
	infoHuman int
}

var _ room.Game[protocol.ClientMsg, protocol.Input, Info] = (*Match)(nil)

// New builds the race (every car a bot). sink nil: nothing is counted.
func New(s race.Settings, sink StatsSink) *Match {
	tr := track.Kiyi()
	m := &Match{r: race.New(s, tr), tr: tr, set: s, stats: sink}
	m.info, m.infoHuman = m.gameInfo(), 0
	return m
}

func (m *Match) Join(who room.Who) (room.PlayerID, error) {
	id, ok := m.r.Seat(who.Name, who.Pilot)
	if !ok {
		return 0, room.Refuse(protocol.CodeRacing)
	}
	m.humans++
	return room.PlayerID(id), nil
}

func (m *Match) Welcome(id room.PlayerID, code, newToken string, out room.Outbox) {
	cid := race.CarID(id)
	out.To(id, protocol.NewWelcome(id, code, newToken, uint8(cid), m.set.Handling.String(), m.set.Contact.String(),
		m.set.Laps, trackName, m.r.Creator() == cid))
	out.To(id, m.gridMsg())
}

func (m *Match) Leave(id room.PlayerID) {
	m.r.Unseat(race.CarID(id))
	m.humans--
}

func (m *Match) Handle(id room.PlayerID, msg protocol.ClientMsg, out room.Outbox) {
	cid := race.CarID(id)
	switch msg.T {
	case protocol.TReady:
		if m.r.Phase() != race.Grid {
			m.notice(id, protocol.CodeNotGrid, "not on the grid", out)
			return
		}
		if msg.Setup != nil {
			m.r.Ready(cid, car.Setup(*msg.Setup))
			m.syncGrid(out, false)
		}
	case protocol.TStart:
		switch {
		case m.r.Creator() != cid:
			m.notice(id, protocol.CodeNotCreator, "only the room creator can start", out)
		case m.r.Phase() != race.Grid:
			m.notice(id, protocol.CodeNotGrid, "not on the grid", out)
		default:
			m.r.Start(cid)
		}
	}
}

func (m *Match) notice(id room.PlayerID, code, msg string, out room.Outbox) {
	out.To(id, netproto.NewNotice(code, msg))
}

// Step runs one tick. Order of sends: snapshot (every SnapEvery ticks), grid
// (when the roster or a ready flag changed, or the phase became grid),
// lights, laps, wings, results.
func (m *Match) Step(inputs map[room.PlayerID]protocol.Input, out room.Outbox) {
	in := make(map[race.CarID]car.Input, len(inputs))
	for id, i := range inputs {
		in[race.CarID(id)] = i.Car()
	}
	ev := m.r.Step(in)
	if ev.LightsOut {
		m.raceStart = m.r.Tick()
	}
	if m.r.Tick()%SnapEvery == 0 {
		out.Snap(m.snap())
	}
	m.syncGrid(out, ev.PhaseChanged && m.r.Phase() == race.Grid)
	if ev.Lights > 0 {
		out.All(protocol.LightsMsg{T: protocol.TLights, On: ev.Lights})
	}
	if ev.LightsOut {
		out.All(protocol.LightsMsg{T: protocol.TLights, Out: m.r.Tick()})
	}
	for _, l := range ev.Laps {
		out.All(protocol.NewLap(l))
	}
	for _, id := range ev.WingLost {
		out.All(protocol.NewWing(id))
	}
	if ev.Results != nil {
		out.All(protocol.NewResults(ev.Results))
	}
	// A marshal reset (ev.Reset) has no message in wire v1: the snapshots show it.
	if gi := m.gameInfo(); gi != m.info || m.humans != m.infoHuman {
		m.info, m.infoHuman = gi, m.humans
		out.Changed()
	}
}

func (m *Match) gridMsg() protocol.GridMsg {
	cars := make([]protocol.GridCar, 0, Seats)
	for _, c := range m.r.Cars() {
		cars = append(cars, protocol.GridCar{ID: uint8(c.ID), Name: c.Driver.Name, Bot: !c.Driver.Human, Ready: c.Driver.Ready})
	}
	return protocol.GridMsg{T: protocol.TGrid, Cars: cars}
}

// syncGrid broadcasts the grid when it differs from the last one sent (or force).
func (m *Match) syncGrid(out room.Outbox, force bool) {
	g := m.gridMsg()
	if !force && slices.Equal(g.Cars, m.grid) {
		return
	}
	m.grid = g.Cars
	out.All(g)
}

func (m *Match) snap() protocol.Snap {
	cars := make([][11]int32, 0, Seats)
	for _, c := range m.r.Cars() {
		cars = append(cars, protocol.EncodeCar(c, protocol.OffTrack(m.tr, c)))
	}
	clock := 0
	if p := m.r.Phase(); p == race.Racing || p == race.Finish {
		clock = (m.r.Tick() - m.raceStart) * 1000 / tickRate
	}
	return protocol.Snap{T: protocol.TSnap, Tick: m.r.Tick(), Phase: m.r.Phase().String(), Clock: clock, Cars: cars}
}

// ChatScope: everyone hears everyone.
func (m *Match) ChatScope(room.PlayerID) func(room.PlayerID) bool {
	return func(room.PlayerID) bool { return true }
}

func (m *Match) gameInfo() Info {
	lap := 0
	for _, c := range m.r.Cars() {
		lap = max(lap, c.Lap)
	}
	return Info{Handling: m.set.Handling.String(), Contact: m.set.Contact.String(), Laps: m.set.Laps,
		Phase: m.r.Phase().String(), Lap: lap}
}

func (m *Match) Info() room.Info[Info] {
	return room.Info[Info]{Humans: m.humans, Seats: Seats, Bots: Seats - m.humans, Listed: m.set.Listed, Game: m.gameInfo()}
}

func (m *Match) Label() string { return m.set.Handling.String() + "/" + m.set.Contact.String() }

// FlushStats and Close have nothing to hand over yet (Task 13 adds stats).
func (m *Match) FlushStats() {}
func (m *Match) Close()      {}
