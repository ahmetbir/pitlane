// Package match is Pitlane's room.Game: it wraps race.Race for the room
// actor and encodes the protocol's messages. Every method runs on the room
// goroutine.
package match

import (
	"fmt"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/pitlane/internal/track"
	"github.com/ahmetbir/roomkit/netproto"
	"github.com/ahmetbir/roomkit/room"
)

const (
	// Seats is every car on the grid, bots included.
	Seats = 10
	// SnapEvery is the number of ticks between snapshots (60 Hz → 30 Hz).
	SnapEvery = 2

	trackName = "kiyi"
)

// StatsSink takes a pilot's tally; it must not block.
type StatsSink interface{ Record(stats.Delta) bool }

// Match is not safe for concurrent use; the room goroutine owns it.
type Match struct {
	r         *race.Race
	tr        *track.Track
	set       race.Settings
	stats     StatsSink
	humans    int
	in        map[race.CarID]car.Input // reused every tick
	grid      [Seats]protocol.GridCar  // last grid sent
	gridOwner uint8                    // creator in the last grid sent
	gridSent  bool
	dmg       [Seats]protocol.DamageInts // last damage sent per car (cars start intact)
	lights    protocol.LightsMsg         // latest lights message
	results   protocol.ResultsMsg        // latest results message
	info      Info
	recorded  map[string]bool // pilots recorded for this race
	bestKey   string          // the best-lap key: track and handling
}

var _ room.Game[protocol.ClientMsg, protocol.Input, Info] = (*Match)(nil)

// New builds the race (every car a bot). sink nil: nothing is counted.
func New(s race.Settings, sink StatsSink) *Match {
	tr := track.Kiyi()
	m := &Match{r: race.New(s, tr), tr: tr, set: s, stats: sink, in: make(map[race.CarID]car.Input, Seats),
		recorded: map[string]bool{}, bestKey: BestKey(s.Handling)}
	m.info = m.gameInfo()
	return m
}

func (m *Match) Join(who room.Who) (room.PlayerID, error) {
	id, ok := m.r.Seat(who.Name, who.Pilot)
	if !ok {
		if p := m.r.Phase(); p == race.Lights || p == race.Racing || p == race.Finish {
			return 0, room.Refuse(protocol.CodeRacing)
		}
		return 0, fmt.Errorf("%w", room.ErrFull)
	}
	m.humans++
	return room.PlayerID(id), nil
}

func (m *Match) Welcome(id room.PlayerID, code, newToken string, out room.Outbox) {
	cid := race.CarID(id)
	c := m.r.Cars()[cid-1]
	out.To(id, protocol.NewWelcome(id, code, newToken, uint8(cid), m.set.Handling.String(), m.set.Contact.String(),
		m.set.Laps, trackName, m.r.Creator() == cid, c.Driver.Setup, c.St.Dmg, c.PenaltyMs))
	m.syncGrid(out, true) // one grid for everyone, the new player included
	switch m.r.Phase() {
	case race.Lights:
		if m.lights.T != "" {
			out.To(id, m.lights)
		}
	case race.Results:
		if m.results.T != "" {
			out.To(id, m.results)
		}
	}
}

// Autopilot is the input a bot would drive id's car with this tick (see race.Race.Autopilot);
// tests and tools use it to script humans.
func (m *Match) Autopilot(id room.PlayerID) car.Input { return m.r.Autopilot(race.CarID(id)) }

func (m *Match) Leave(id room.PlayerID) {
	// A finisher who leaves before Results is recorded now, at the place they hold.
	if row, ok := m.r.Standing(race.CarID(id)); ok && row.Finished && m.r.Phase() == race.Finish {
		m.record([]race.ResultRow{row})
	}
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

// Step runs one tick. Order of sends: damage changes, snapshot (every
// SnapEvery ticks), grid (when the roster or a ready flag changed, or the
// phase became grid), lights, laps, wings, jump-start penalties, resets, results.
func (m *Match) Step(inputs map[room.PlayerID]protocol.Input, out room.Outbox) {
	clear(m.in)
	for id, i := range inputs { // each input touches its own car only: map order does not matter
		m.in[race.CarID(id)] = i.Car()
		if lv, ok := i.Live(); ok {
			m.r.Live(race.CarID(id), lv)
		}
	}
	ev := m.r.Step(m.in)
	m.syncDamage(out)
	if m.r.Tick()%SnapEvery == 0 {
		out.Snap(m.snap())
	}
	m.syncGrid(out, ev.PhaseChanged && m.r.Phase() == race.Grid)
	if ev.PhaseChanged && m.r.Phase() == race.Lights {
		m.lights = protocol.LightsMsg{} // the previous race's lights are not this race's
		clear(m.recorded)
	}
	if ev.Lights > 0 {
		m.lights = protocol.LightsMsg{T: protocol.TLights, On: ev.Lights}
		out.All(m.lights)
	}
	if ev.LightsOut {
		m.lights = protocol.LightsMsg{T: protocol.TLights, Out: m.r.Tick()}
		out.All(m.lights)
	}
	for _, l := range ev.Laps {
		out.All(protocol.NewLap(l))
	}
	for _, id := range ev.WingLost {
		out.All(protocol.NewWing(id))
	}
	for _, id := range ev.JumpStart {
		out.All(protocol.NewJumpPen(id, race.JumpStartPenMs))
	}
	for _, id := range ev.Reset {
		out.All(protocol.NewReset(id))
	}
	if ev.Results != nil {
		m.results = protocol.NewResults(ev.Results)
		out.All(m.results)
		m.record(ev.Results)
	}
	// Join and leave are republished by the room itself; only the game's own changes here.
	if gi := m.gameInfo(); gi != m.info {
		m.info = gi
		out.Changed()
	}
}

func gridCar(c *race.Car) protocol.GridCar {
	return protocol.GridCar{ID: uint8(c.ID), Name: c.Driver.Name, Bot: !c.Driver.Human, Ready: c.Driver.Ready}
}

// syncGrid broadcasts the grid when it differs from the last one sent (or
// force). The comparison allocates nothing; the message is built on change only.
func (m *Match) syncGrid(out room.Outbox, force bool) {
	cars, owner := m.r.Cars(), uint8(m.r.Creator())
	changed := force || !m.gridSent || owner != m.gridOwner
	for i, c := range cars {
		if changed {
			break
		}
		changed = gridCar(c) != m.grid[i]
	}
	if !changed {
		return
	}
	msg := protocol.GridMsg{T: protocol.TGrid, Cars: make([]protocol.GridCar, len(cars)), Creator: owner}
	for i, c := range cars {
		msg.Cars[i] = gridCar(c)
		m.grid[i] = msg.Cars[i]
	}
	m.gridOwner, m.gridSent = owner, true
	out.All(msg)
}

// syncDamage broadcasts every car whose wire damage differs from the last
// one sent; the comparison allocates nothing.
func (m *Match) syncDamage(out room.Outbox) {
	for i, c := range m.r.Cars() {
		if d := protocol.EncodeDamage(c.St.Dmg); d != m.dmg[i] {
			m.dmg[i] = d
			out.All(protocol.NewDmg(c.ID, d))
		}
	}
}

func (m *Match) snap() protocol.Snap {
	cars := make([][11]int32, 0, Seats)
	for _, c := range m.r.Cars() {
		cars = append(cars, protocol.EncodeCar(c, protocol.OffTrack(m.tr, c)))
	}
	clock := 0
	if p := m.r.Phase(); p == race.Racing || p == race.Finish {
		clock = (m.r.Tick() - m.r.RaceStart()) * 1000 / race.TickRate
	}
	return protocol.Snap{T: protocol.TSnap, Tick: m.r.Tick(), Phase: m.r.Phase().String(), Clock: clock, Cars: cars}
}

// ChatScope: everyone hears everyone.
func (m *Match) ChatScope(room.PlayerID) func(room.PlayerID) bool {
	return func(room.PlayerID) bool { return true }
}

func (m *Match) gameInfo() Info {
	lap := 0 // the leader's current lap while the race runs
	if p := m.r.Phase(); p != race.Grid && p != race.Lights {
		for _, c := range m.r.Cars() {
			lap = max(lap, c.Lap)
		}
		lap = min(lap+1, m.set.Laps)
	}
	return Info{Handling: m.set.Handling.String(), Contact: m.set.Contact.String(), Laps: m.set.Laps,
		Phase: m.r.Phase().String(), Lap: lap}
}

func (m *Match) Info() room.Info[Info] {
	return room.Info[Info]{Humans: m.humans, Seats: Seats, Bots: Seats - m.humans, Listed: m.set.Listed, Game: m.gameInfo()}
}

func (m *Match) Label() string { return m.set.Handling.String() + "/" + m.set.Contact.String() }

// BestKey is the best-lap key of a room: "kiyi-arcade", "kiyi-sim".
func BestKey(h car.Handling) string { return trackName + "-" + h.String() }

// record counts the race of every human with a pilot in rows, once per pilot
// and race: at Results (the final classification), or when a finisher leaves
// before it. Bots and
// pilotless humans never count, and a human who left mid-race is a bot again
// by now. Only what the pilot earned since taking the car over counts (see
// race.Credit): laps, the best valid lap, and a race, win or podium for a
// finish (their own flag) after one full lap of their own. A DNF keeps its laps and best lap.
// A pilot in two seats (two tabs) counts once, by the better position.
func (m *Match) record(rows []race.ResultRow) {
	if m.stats == nil {
		return
	}
	best := make(map[string]race.ResultRow, len(rows))
	for _, r := range rows {
		if b, ok := best[r.Pilot]; r.Human && r.Pilot != "" && !m.recorded[r.Pilot] && (!ok || r.Pos < b.Pos) {
			best[r.Pilot] = r
		}
	}
	for _, r := range rows { // row order, so records are deterministic
		if b, ok := best[r.Pilot]; !ok || b.Car != r.Car {
			continue
		}
		m.recorded[r.Pilot] = true
		c := r.Credit
		d := stats.Delta{Pilot: r.Pilot, Name: r.Name, Laps: c.Laps}
		if r.Finished && c.Full && c.Flag {
			d.Races = 1
			if r.Pos == 1 {
				d.Wins = 1
			}
			if r.Pos <= 3 {
				d.Podiums = 1
			}
		}
		if c.BestMs > 0 {
			d.BestMs = map[string]int{m.bestKey: c.BestMs}
		}
		if d.Races > 0 || d.Laps > 0 || d.BestMs != nil { // a DNF without a lap is nothing
			m.stats.Record(d)
		}
	}
}

// FlushStats and Close have nothing to hand over: records are written at Results.
func (m *Match) FlushStats() {}
func (m *Match) Close()      {}
