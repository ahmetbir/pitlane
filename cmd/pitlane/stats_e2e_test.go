package main

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/front"
	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/roomkit/metrics"
	"github.com/ahmetbir/roomkit/pilot"
	"github.com/ahmetbir/roomkit/room"
)

// resultsOut keeps the results message; everything else is dropped.
type resultsOut struct{ results *protocol.ResultsMsg }

func (o *resultsOut) To(room.PlayerID, any) {}
func (o *resultsOut) Changed()              {}
func (o *resultsOut) Snap(room.Acker)       {}
func (o *resultsOut) All(v any) {
	if r, ok := v.(protocol.ResultsMsg); ok {
		o.results = &r
	}
}

func getBody(t *testing.T, url, tok string) string {
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
	if res.StatusCode != 200 {
		t.Fatalf("%s: %d %s", url, res.StatusCode, b)
	}
	return string(b)
}

// A server with -data: a seeded race with one human seat runs to its results,
// and the boards and the pilot card show it.
func TestStatsEndToEnd(t *testing.T) {
	cfg, err := parseFlags([]string{"-data", t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	slot := stats.NewSlot()
	acquireStats(t.Context(), slot, cfg.dataDir, time.Millisecond, time.Second)
	defer slot.Close()
	lb := match.NewLobby(t.Context(), 2, metrics.New("pitlane", nil), slot)
	ts := httptest.NewServer(front.NewServer(lb, cfg.server(nil, slot)))
	defer ts.Close()

	tok := pilot.New()
	m := match.New(race.Settings{Handling: car.Arcade, Contact: race.Soft, Laps: 3, Seed: 7}, slot)
	out := &resultsOut{}
	id, err := m.Join(room.Who{Name: "Ace", Pilot: pilot.Hash(tok)})
	if err != nil {
		t.Fatal(err)
	}
	m.Welcome(id, "ABCD", "", out)
	m.Handle(id, protocol.ClientMsg{T: protocol.TStart}, out)
	for i := 0; i < 600*60 && out.results == nil; i++ {
		m.Step(nil, out)
	}
	if out.results == nil {
		t.Fatal("the race never reached its results")
	}
	var row protocol.ResultRowMsg
	for _, r := range out.results.Rows {
		if r.ID == uint8(id) {
			row = r
		}
	}
	wins, podiums := 0, 0
	if row.Pos == 1 {
		wins = 1
	}
	if row.Pos <= 3 {
		podiums = 1
	}
	// A second pilot with a best lap, so the lap boards have a row.
	slot.Record(stats.Delta{Pilot: "fast", Name: "Fast", Races: 1, Laps: 3, BestMs: map[string]int{"kiyi": 83000}})

	var me string
	eventually(t, func() bool {
		req, _ := http.NewRequest("GET", ts.URL+"/api/me", nil)
		req.Header.Set(pilot.Header, tok)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			return false
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		me = string(b)
		return me != `{"pilot":null}`
	}, "the record never reached the store")
	if want := fmt.Sprintf(`{"pilot":{"name":"Ace","races":1,"wins":%d,"podiums":%d,"laps":%d,"best":{}}}`, wins, podiums, row.Laps); me != want {
		t.Fatalf("\n%s\n%s", me, want)
	}
	eventually(t, func() bool { _, _, ok := slot.Get("fast"); return ok }, "second record")

	week := stats.WeekOf(time.Now())
	if got, want := getBody(t, ts.URL+"/api/leaderboard?period=all&key=kiyi", ""),
		`{"period":"all","key":"kiyi","week":"`+week+`","top":[{"name":"Fast","ms":83000}]}`; got != want {
		t.Fatalf("\n%s\n%s", got, want)
	}
	ace := fmt.Sprintf(`{"name":"Ace","wins":%d,"podiums":%d,"races":1}`, wins, podiums)
	fast := `{"name":"Fast","wins":0,"podiums":0,"races":1}`
	top := ace + "," + fast // Ace never ranks below Fast: wins, podiums, races desc, then name asc
	if got, want := getBody(t, ts.URL+"/api/leaderboard?period=all", ""),
		`{"period":"all","key":"","week":"`+week+`","top":[`+top+`]}`; got != want {
		t.Fatalf("\n%s\n%s", got, want)
	}
}
