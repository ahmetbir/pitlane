package match

import (
	"errors"
	"math"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/roomkit/netproto"
	"github.com/ahmetbir/roomkit/room"
)

type sent struct {
	to  room.PlayerID // 0 = all
	msg any
}

// fakeOut records what the game sends; Snap is expanded per player like the room does.
type fakeOut struct {
	players []room.PlayerID
	sent    []sent
	changed int
}

func (o *fakeOut) To(id room.PlayerID, v any) { o.sent = append(o.sent, sent{id, v}) }
func (o *fakeOut) All(v any)                  { o.sent = append(o.sent, sent{0, v}) }
func (o *fakeOut) Changed()                   { o.changed++ }
func (o *fakeOut) Snap(v room.Acker) {
	for _, id := range o.players {
		o.sent = append(o.sent, sent{id, v.WithAck(uint32(id) * 100)})
	}
}

func (o *fakeOut) take() []sent { s := o.sent; o.sent = nil; return s }

func of[T any](ss []sent) (r []T) {
	for _, s := range ss {
		if v, ok := s.msg.(T); ok {
			r = append(r, v)
		}
	}
	return r
}

func newMatch() *Match {
	return New(race.Settings{Handling: car.Arcade, Contact: race.Soft, Laps: 3, Listed: true, Seed: 7}, nil)
}

func join(t *testing.T, m *Match, out *fakeOut, name string) room.PlayerID {
	t.Helper()
	id, err := m.Join(room.Who{Name: name})
	if err != nil {
		t.Fatal(err)
	}
	out.players = append(out.players, id)
	m.Welcome(id, "ABCD", "", out)
	return id
}

func TestJoinWelcomeLeave(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	b := join(t, m, out, "Bee")
	if a != 1 || b != 2 {
		t.Fatalf("ids %d %d", a, b)
	}
	ws := of[protocol.Welcome](out.take())
	if len(ws) != 2 || !ws[0].Creator || ws[1].Creator || ws[0].Car != 1 || ws[0].You != a || ws[0].Code != "ABCD" ||
		ws[0].Handling != "arcade" || ws[0].Contact != "soft" || ws[0].Laps != 3 || ws[0].Track != "kiyi" {
		t.Fatalf("welcomes %+v", ws)
	}
	in := m.Info()
	if in.Humans != 2 || in.Seats != 10 || in.Bots != 8 || !in.Listed || in.Game.Phase != "grid" || in.Game.Handling != "arcade" {
		t.Fatalf("info %+v", in)
	}
	m.Leave(a)
	if in = m.Info(); in.Humans != 1 || in.Bots != 9 {
		t.Fatalf("info after leave %+v", in)
	}
	if m.Label() != "arcade/soft" {
		t.Fatal(m.Label())
	}
}

func TestWelcomeSendsGridAndTok(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	id, _ := m.Join(room.Who{Name: "Ace"})
	m.Welcome(id, "ABCD", "tok", out)
	ss := out.take()
	w, g := of[protocol.Welcome](ss), of[protocol.GridMsg](ss)
	if len(w) != 1 || w[0].Tok != "tok" || len(g) != 1 || len(g[0].Cars) != 10 || g[0].Cars[0].Name != "Ace" || g[0].Cars[0].Bot || g[0].Creator != 1 {
		t.Fatalf("%+v %+v", w, g)
	}
}

func TestStartRules(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	b := join(t, m, out, "Bee")
	out.take()
	m.Handle(b, protocol.ClientMsg{T: protocol.TStart}, out)
	ns := of[netproto.NoticeMsg](out.take())
	if len(ns) != 1 || ns[0].Code != protocol.CodeNotCreator || m.r.Phase() != race.Grid {
		t.Fatalf("%+v", ns)
	}
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	m.Step(nil, out)
	if m.r.Phase() != race.Lights {
		t.Fatalf("phase %v", m.r.Phase())
	}
	out.take()
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	m.Handle(a, protocol.ClientMsg{T: protocol.TReady, Setup: &protocol.SetupInts{6, 6, 58, 3, 5, 5}}, out)
	ns = of[netproto.NoticeMsg](out.take())
	if len(ns) != 2 || ns[0].Code != protocol.CodeNotGrid || ns[1].Code != protocol.CodeNotGrid {
		t.Fatalf("%+v", ns)
	}
}

func TestReadyBroadcastsGrid(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	m.Step(nil, out)
	out.take()
	m.Handle(a, protocol.ClientMsg{T: protocol.TReady, Setup: &protocol.SetupInts{1, 2, 60, 3, 4, 5}}, out)
	gs := of[protocol.GridMsg](out.take())
	if len(gs) != 1 || !gs[0].Cars[0].Ready || gs[0].Cars[1].Ready {
		t.Fatalf("%+v", gs)
	}
	if got := m.r.Cars()[0].Driver.Setup; got != (car.Setup{1, 2, 60, 3, 4, 5}) {
		t.Fatalf("setup %v", got)
	}
	m.Step(nil, out) // nothing changed: no second grid
	if gs = of[protocol.GridMsg](out.take()); len(gs) != 0 {
		t.Fatalf("duplicate grid %+v", gs)
	}
}

// run steps until pred holds or n ticks pass.
func run(m *Match, out *fakeOut, n int, pred func() bool) {
	for i := 0; i < n && !pred(); i++ {
		m.Step(nil, out)
	}
}

func TestFullFlow(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	m.Handle(a, protocol.ClientMsg{T: protocol.TReady, Setup: &protocol.SetupInts{6, 6, 58, 3, 5, 5}}, out)
	m.Step(nil, out) // everyone ready: the grid ends
	if m.r.Phase() != race.Lights {
		t.Fatalf("phase %v", m.r.Phase())
	}
	out.take()
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Racing })
	ss := out.take()
	var on []int
	for _, l := range of[protocol.LightsMsg](ss) {
		on = append(on, l.On)
		if l.On == 0 && l.Out != m.r.RaceStart() {
			t.Fatalf("lights out at %d, race start %d", l.Out, m.r.RaceStart())
		}
	}
	if len(on) != 6 || on[0] != 1 || on[4] != 5 || on[5] != 0 {
		t.Fatalf("lights %v", on)
	}
	for _, s := range ss {
		if sn, ok := s.msg.(protocol.Snap); ok && sn.Phase == "lights" && sn.Clock != 0 {
			t.Fatal("clock before the start")
		}
	}
	for i := 0; i < 120; i++ {
		m.Step(map[room.PlayerID]protocol.Input{a: {Th: 100}}, out)
	}
	snaps := of[protocol.Snap](out.take())
	last := snaps[len(snaps)-1]
	if last.Phase != "racing" || last.Clock <= 0 || len(last.Cars) != 10 || last.Cars[0][0] != 1 || last.Cars[0][10]&protocol.FlagBot != 0 ||
		last.Cars[1][10]&protocol.FlagBot == 0 {
		t.Fatalf("snap %+v", last)
	}
	if last.Cars[0][4] <= 0 {
		t.Fatalf("human did not accelerate: %v", last.Cars[0])
	}
	if out.changed == 0 {
		t.Fatal("phase change never republished the lobby info")
	}
	if m.Info().Game.Phase != "racing" {
		t.Fatal("info phase")
	}
}

func TestSnapEverySecondTickWithAck(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	b := join(t, m, out, "Bee")
	out.take()
	var ticks []int
	for i := 0; i < 6; i++ {
		m.Step(nil, out)
		for _, s := range out.take() {
			if sn, ok := s.msg.(protocol.Snap); ok {
				if sn.Ack != uint32(s.to)*100 {
					t.Fatalf("player %d ack %d", s.to, sn.Ack)
				}
				if s.to == a {
					ticks = append(ticks, sn.Tick)
				}
			}
		}
	}
	if len(ticks) != 3 || ticks[0] != 2 || ticks[1] != 4 || ticks[2] != 6 {
		t.Fatalf("snap ticks %v", ticks)
	}
	_ = b
}

func TestJoinWhileRacingTakesLastBot(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	join(t, m, out, "Ace")
	m.Handle(1, protocol.ClientMsg{T: protocol.TStart}, out)
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Racing })
	if m.r.Phase() != race.Racing {
		t.Fatal("not racing")
	}
	want := m.r.Cars()[1].ID
	for _, c := range m.r.Cars() {
		if !c.Driver.Human && c.Pos > m.r.Cars()[want-1].Pos {
			want = c.ID
		}
	}
	id, err := m.Join(room.Who{Name: "Late"})
	if err != nil || race.CarID(id) != want {
		t.Fatalf("id %d want %d err %v", id, want, err)
	}
}

func TestRefusalWhenFullAndRacing(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	for i := 0; i < 10; i++ {
		join(t, m, out, "P")
	}
	m.Handle(1, protocol.ClientMsg{T: protocol.TStart}, out)
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Racing })
	_, err := m.Join(room.Who{Name: "X"})
	var ref *room.Refusal
	if !errors.As(err, &ref) || ref.Code != "racing" {
		t.Fatalf("err %v", err)
	}
	if m.Info().Humans != 10 || m.Info().Bots != 0 {
		t.Fatalf("%+v", m.Info())
	}
}

func TestResultsAndGridMessages(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	join(t, m, out, "Ace")
	m.Handle(1, protocol.ClientMsg{T: protocol.TStart}, out)
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Racing })
	m.Leave(1) // an idle human car on the grid would block the bots for good
	out.sent = nil
	run(m, out, 600*60, func() bool { return m.r.Phase() == race.Results })
	rs := of[protocol.ResultsMsg](out.take())
	if len(rs) != 1 || len(rs[0].Rows) != 10 {
		t.Fatalf("results %+v", rs)
	}
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Grid })
	if gs := of[protocol.GridMsg](out.take()); len(gs) == 0 {
		t.Fatal("no grid after returning to the grid")
	}
}

func TestChatScopeEveryone(t *testing.T) {
	m := newMatch()
	if !m.ChatScope(1)(2) || !m.ChatScope(3)(9) {
		t.Fatal("chat must reach everyone")
	}
}

// TestResetBroadcast: a human whose car stands facing the wrong way after lights out (it
// cannot drive away without a reverse gear) is put back on the racing line by the marshals,
// and everyone hears the reset.
func TestResetBroadcast(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Idle")
	m.Handle(a, protocol.ClientMsg{T: protocol.TReady, Setup: &protocol.SetupInts{6, 6, 58, 3, 5, 5}}, out)
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Racing })
	st := &m.r.Cars()[a-1].St
	st.HX, st.HZ, st.H = -st.HX, -st.HZ, st.H+math.Pi
	out.take()
	var resets []protocol.ResetMsg
	for i := 0; i < 60*60 && len(resets) == 0; i++ {
		m.Step(nil, out)
		for _, s := range out.take() {
			if r, ok := s.msg.(protocol.ResetMsg); ok {
				if s.to != 0 {
					t.Fatalf("reset sent to %d only", s.to)
				}
				resets = append(resets, r)
			}
		}
	}
	if len(resets) == 0 || resets[0] != (protocol.ResetMsg{T: protocol.TReset, Car: uint8(a)}) {
		t.Fatalf("resets %+v", resets)
	}
}

func TestJoinSendsOneGrid(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	join(t, m, out, "Ace")
	out.take()
	join(t, m, out, "Bee")
	m.Step(nil, out)
	gs := of[protocol.GridMsg](out.take())
	if len(gs) != 1 || gs[0].Cars[1].Name != "Bee" {
		t.Fatalf("%+v", gs)
	}
}

func TestCreatorHandoverReachesClients(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	join(t, m, out, "Bee")
	m.Step(nil, out)
	out.take()
	m.Leave(a)
	m.Step(nil, out)
	gs := of[protocol.GridMsg](out.take())
	if len(gs) != 1 || gs[0].Creator != 2 || !gs[0].Cars[0].Bot || gs[0].Cars[1].Bot {
		t.Fatalf("%+v", gs)
	}
	m.Step(nil, out)
	if gs = of[protocol.GridMsg](out.take()); len(gs) != 0 {
		t.Fatalf("duplicate %+v", gs)
	}
}

func TestFullGridRoomIsErrFullNotRefusal(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	for i := 0; i < 10; i++ {
		join(t, m, out, "P")
	}
	_, err := m.Join(room.Who{Name: "X"})
	var ref *room.Refusal
	if !errors.Is(err, room.ErrFull) || errors.As(err, &ref) {
		t.Fatalf("err %v", err)
	}
}

func TestLateJoinerGetsLightsAndResults(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Lights && m.lights.On == 3 })
	out.take()
	id, err := m.Join(room.Who{Name: "Bee"})
	if err != nil {
		t.Fatal(err)
	}
	m.Welcome(id, "ABCD", "", out)
	ls := of[protocol.LightsMsg](out.take())
	if len(ls) != 1 || ls[0].On != 3 {
		t.Fatalf("lights %+v", ls)
	}
	m.Leave(id)
	m.Leave(a)
	run(m, out, 600*60, func() bool { return m.r.Phase() == race.Results })
	id, _ = m.Join(room.Who{Name: "Cy"})
	out.take()
	m.Welcome(id, "ABCD", "", out)
	rs := of[protocol.ResultsMsg](out.take())
	if len(rs) != 1 || len(rs[0].Rows) != 10 {
		t.Fatalf("results %+v", rs)
	}
}

func TestRematchLateJoinerGetsNoStaleLights(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	run(m, out, 600*60, func() bool { return m.r.Phase() == race.Results })
	if m.lights.Out == 0 {
		t.Fatalf("race 1 never reached lights out: %+v", m.lights)
	}
	run(m, out, 600*60, func() bool { return m.r.Phase() == race.Grid })
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	m.Step(nil, out) // race 2 enters the lights
	if m.r.Phase() != race.Lights {
		t.Fatalf("phase %v", m.r.Phase())
	}
	id, err := m.Join(room.Who{Name: "Bee"})
	if err != nil {
		t.Fatal(err)
	}
	out.take()
	m.Welcome(id, "ABCD", "", out)
	if ls := of[protocol.LightsMsg](out.take()); len(ls) != 0 {
		t.Fatalf("stale lights %+v", ls)
	}
}

func TestInfoLapAndChanged(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	if m.Info().Game.Lap != 0 {
		t.Fatal("grid lap")
	}
	m.Step(nil, out)
	if out.changed != 0 {
		t.Fatalf("join alone must not call Changed (the room republishes): %d", out.changed)
	}
	m.Handle(a, protocol.ClientMsg{T: protocol.TStart}, out)
	run(m, out, 20*60, func() bool { return m.r.Phase() == race.Racing })
	if out.changed == 0 || m.Info().Game.Lap != 1 {
		t.Fatalf("changed %d info %+v", out.changed, m.Info().Game)
	}
}

func TestStepAllocs(t *testing.T) {
	m, out := newMatch(), &fakeOut{}
	a := join(t, m, out, "Ace")
	m.Step(nil, out)
	in := map[room.PlayerID]protocol.Input{a: {}}
	out.take()
	n := testing.AllocsPerRun(50, func() {
		m.syncGrid(out, false)
		clear(m.in)
		for id, i := range in {
			m.in[race.CarID(id)] = i.Car()
		}
	})
	if n != 0 {
		t.Fatalf("%v allocs per unchanged grid check and input conversion", n)
	}
}
