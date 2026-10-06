package front

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/roomkit/ledger"
	"github.com/ahmetbir/roomkit/metrics"
	"github.com/ahmetbir/roomkit/pilot"
	"github.com/ahmetbir/roomkit/server"
)

var statsNow = time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC) // 2026-W41

// openSlot is a slot over a temp-dir store whose clock is statsNow.
func openSlot(t *testing.T) *stats.Slot {
	t.Helper()
	st, err := stats.Open(t.TempDir(), ledger.Options{Now: func() time.Time { return statsNow }, Log: slog.New(slog.DiscardHandler)})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	sl.Set(st)
	t.Cleanup(func() { sl.Close() })
	return sl
}

// settle waits for the store's queue: Get runs after every earlier Record.
func settle(sl *stats.Slot) { sl.Get("") }

func api(sl *stats.Slot) statsAPI { return statsAPI{sl, func() time.Time { return statsNow }} }

func TestNewStatsNilIsNilInterface(t *testing.T) {
	if NewStats(nil) != nil {
		t.Fatal("nil slot must be a nil server.Stats")
	}
}

func TestBoardsList(t *testing.T) {
	want := []server.BoardID{{Period: "week"}, {Period: "all"}, {Period: "week", Key: "kiyi-arcade"}, {Period: "all", Key: "kiyi-arcade"},
		{Period: "week", Key: "kiyi-sim"}, {Period: "all", Key: "kiyi-sim"}}
	got := api(stats.NewSlot()).Boards()
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("%v", got)
	}
}

func TestWinsBoardRanking(t *testing.T) {
	sl := openSlot(t)
	for _, d := range []stats.Delta{
		{Pilot: "p1", Name: "Cy", Races: 5, Wins: 2, Podiums: 3},
		{Pilot: "p2", Name: "Bee", Races: 4, Wins: 2, Podiums: 4},
		{Pilot: "p3", Name: "Ace", Races: 9, Wins: 2, Podiums: 3},
		{Pilot: "p4", Name: "Abe", Races: 9, Wins: 2, Podiums: 3}, // ties Ace: name asc
		{Pilot: "p5", Name: "Dee", Races: 1},
	} {
		sl.Record(d)
	}
	settle(sl)
	got := string(api(sl).Board(server.BoardID{Period: "all"}))
	want := `{"period":"all","key":"","week":"2026-W41","top":[` +
		`{"name":"Bee","wins":2,"podiums":4,"races":4},` +
		`{"name":"Abe","wins":2,"podiums":3,"races":9},` +
		`{"name":"Ace","wins":2,"podiums":3,"races":9},` +
		`{"name":"Cy","wins":2,"podiums":3,"races":5},` +
		`{"name":"Dee","wins":0,"podiums":0,"races":1}]}`
	if got != want {
		t.Fatalf("\n%s\n%s", got, want)
	}
}

func TestLapBoardRankingAndTop20(t *testing.T) {
	sl := openSlot(t)
	for i := range 25 {
		sl.Record(stats.Delta{Pilot: fmt.Sprintf("p%02d", i), Name: fmt.Sprintf("N%02d", i), Races: 1, BestMs: map[string]int{"kiyi-arcade": 90000 - i*100}})
	}
	sl.Record(stats.Delta{Pilot: "nolap", Name: "None", Races: 1})
	settle(sl)
	b := api(sl).Board(server.BoardID{Period: "all", Key: "kiyi-arcade"})
	var body struct {
		Key string
		Top []struct {
			Name string
			Ms   int
		}
	}
	mustJSON(t, b, &body)
	if body.Key != "kiyi-arcade" || len(body.Top) != 20 || body.Top[0].Name != "N24" || body.Top[0].Ms != 87600 || body.Top[19].Name != "N05" {
		t.Fatalf("%s", b)
	}
}

func TestWeekBoardIgnoresOlderWeeks(t *testing.T) {
	sl := openSlot(t)
	sl.Record(stats.Delta{Pilot: "old", Name: "Old", Races: 1, Wins: 1, BestMs: map[string]int{"kiyi-arcade": 80000}, Week: "2026-W40"})
	sl.Record(stats.Delta{Pilot: "new", Name: "New", Races: 1, BestMs: map[string]int{"kiyi-arcade": 90000}})
	settle(sl)
	a := api(sl)
	if got := string(a.Board(server.BoardID{Period: "week"})); got != `{"period":"week","key":"","week":"2026-W41","top":[{"name":"New","wins":0,"podiums":0,"races":1}]}` {
		t.Fatal(got)
	}
	if got := string(a.Board(server.BoardID{Period: "week", Key: "kiyi-arcade"})); got != `{"period":"week","key":"kiyi-arcade","week":"2026-W41","top":[{"name":"New","ms":90000}]}` {
		t.Fatal(got)
	}
	if got := string(a.Board(server.BoardID{Period: "all", Key: "kiyi-arcade"})); got != `{"period":"all","key":"kiyi-arcade","week":"2026-W41","top":[{"name":"Old","ms":80000},{"name":"New","ms":90000}]}` {
		t.Fatal(got)
	}
}

// Arcade and Sim laps never share a board.
func TestLapBoardsPerHandling(t *testing.T) {
	sl := openSlot(t)
	sl.Record(stats.Delta{Pilot: "a", Name: "Arc", Races: 1, BestMs: map[string]int{"kiyi-arcade": 71000}})
	sl.Record(stats.Delta{Pilot: "s", Name: "Sim", Races: 1, BestMs: map[string]int{"kiyi-sim": 76500}})
	settle(sl)
	a := api(sl)
	if got := string(a.Board(server.BoardID{Period: "all", Key: "kiyi-arcade"})); got != `{"period":"all","key":"kiyi-arcade","week":"2026-W41","top":[{"name":"Arc","ms":71000}]}` {
		t.Fatal(got)
	}
	if got := string(a.Board(server.BoardID{Period: "week", Key: "kiyi-sim"})); got != `{"period":"week","key":"kiyi-sim","week":"2026-W41","top":[{"name":"Sim","ms":76500}]}` {
		t.Fatal(got)
	}
	if a.Board(server.BoardID{Period: "all", Key: "kiyi"}) != nil {
		t.Fatal("the old mixed board is still served")
	}
}

func TestEmptyBoardIsAnArray(t *testing.T) {
	sl := openSlot(t)
	if got := string(api(sl).Board(server.BoardID{Period: "all", Key: "kiyi-arcade"})); got != `{"period":"all","key":"kiyi-arcade","week":"2026-W41","top":[]}` {
		t.Fatal(got)
	}
}

func TestBoardNilWhenUnknownOrClosed(t *testing.T) {
	sl := openSlot(t)
	a := api(sl)
	for _, id := range []server.BoardID{{Period: "month"}, {Period: "all", Key: "other"}, {}} {
		if a.Board(id) != nil {
			t.Errorf("%v served", id)
		}
	}
	sl.Close()
	if a.Ready() || a.Board(server.BoardID{Period: "all"}) != nil {
		t.Fatal("closed store: not ready, no board")
	}
}

func TestMeBody(t *testing.T) {
	sl := openSlot(t)
	a := api(sl)
	if _, ok := a.Me("zz"); ok {
		t.Fatal("unknown pilot")
	}
	sl.Record(stats.Delta{Pilot: "aa", Name: "Ace", Races: 2, Wins: 1, Podiums: 2, Laps: 6, BestMs: map[string]int{"kiyi-arcade": 83000}})
	sl.Record(stats.Delta{Pilot: "bb", Name: "Bee", Races: 1})
	settle(sl)
	b, ok := a.Me("aa")
	if want := `{"pilot":{"name":"Ace","races":2,"wins":1,"podiums":2,"laps":6,"best":{"kiyi-arcade":83000}}}`; !ok || string(b) != want {
		t.Fatalf("%s %v", b, ok)
	}
	if b, _ := a.Me("bb"); string(b) != `{"pilot":{"name":"Bee","races":1,"wins":0,"podiums":0,"laps":0,"best":{}}}` {
		t.Fatalf("%s", b)
	}
}

// The boards and the card through the real server.
func TestLeaderboardAndMeThroughServer(t *testing.T) {
	sl := openSlot(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	lb := match.NewLobby(ctx, 4, metrics.New("pitlane", nil), nil)
	ts := httptest.NewServer(NewServer(lb, server.Options{Stats: NewStats(sl), Limits: server.DefaultLimits()}))
	defer ts.Close()
	tok := pilot.New()
	sl.Record(stats.Delta{Pilot: pilot.Hash(tok), Name: "Ace", Races: 1, Wins: 1, Podiums: 1, Laps: 3, BestMs: map[string]int{"kiyi-arcade": 83000}})
	settle(sl)

	code, body := get(t, ts.URL+"/api/leaderboard?period=all&key=kiyi-arcade", "")
	if code != 200 || body != `{"period":"all","key":"kiyi-arcade","week":"`+stats.WeekOf(time.Now())+`","top":[{"name":"Ace","ms":83000}]}` {
		t.Fatalf("%d %s", code, body)
	}
	if code, _ = get(t, ts.URL+"/api/leaderboard?period=all&key=nope", ""); code == 200 {
		t.Fatal("a board outside the whitelist")
	}
	code, body = get(t, ts.URL+"/api/me", tok)
	if code != 200 || body != `{"pilot":{"name":"Ace","races":1,"wins":1,"podiums":1,"laps":3,"best":{"kiyi-arcade":83000}}}` {
		t.Fatalf("%d %s", code, body)
	}
}

func get(t *testing.T, url, tok string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest("GET", url, nil)
	if tok != "" {
		req.Header.Set(pilot.Header, tok)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func mustJSON(t *testing.T, b []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("%v: %s", err, b)
	}
}
