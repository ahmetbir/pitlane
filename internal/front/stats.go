package front

import (
	"cmp"
	"encoding/json"
	"slices"
	"time"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/roomkit/ledger"
	"github.com/ahmetbir/roomkit/server"
)

const (
	boardSize = 20
	periodWk  = "week"
	periodAll = "all"
)

type statsAPI struct {
	slot *stats.Slot
	now  func() time.Time
}

// NewStats is the pilot API over slot; a nil slot (stats off) is a nil
// server.Stats, never a typed nil.
func NewStats(slot *stats.Slot) server.Stats {
	if slot == nil {
		return nil
	}
	return statsAPI{slot, time.Now}
}

func (a statsAPI) Ready() bool { return a.slot.Ready() }

// Boards: wins per period, and the best laps per period and handling (Arcade
// and Sim laps never share a board).
func (statsAPI) Boards() []server.BoardID {
	arcade, sim := match.BestKey(car.Arcade), match.BestKey(car.Sim)
	return []server.BoardID{{Period: periodWk}, {Period: periodAll},
		{Period: periodWk, Key: arcade}, {Period: periodAll, Key: arcade},
		{Period: periodWk, Key: sim}, {Period: periodAll, Key: sim}}
}

type winRow struct {
	Name    string `json:"name"`
	Wins    int    `json:"wins"`
	Podiums int    `json:"podiums"`
	Races   int    `json:"races"`
}

type lapRow struct {
	Name string `json:"name"`
	Ms   int    `json:"ms"`
}

// ranked is a row with its hash, the last tie-break: map order must not show.
type ranked[T any] struct {
	row  T
	hash string
}

// Board is GET /api/leaderboard's body: {"period","key","week","top"}; nil
// for a board that is not served and while the store is closed.
func (a statsAPI) Board(id server.BoardID) []byte {
	if !slices.Contains(a.Boards(), id) {
		return nil
	}
	week := stats.WeekOf(a.now())
	weekly := id.Period == periodWk
	var wins []ranked[winRow]
	var laps []ranked[lapRow]
	open := false
	a.slot.View(func(all map[string]ledger.Entry[stats.Record]) {
		open = true
		for h, e := range all {
			r := e.R
			races, w, p, best := r.Races, r.Wins, r.Podiums, r.Best
			if weekly {
				races, w, p, best = r.WeekRaces, r.WeekWins, r.WeekPodiums, r.WeekBest
				if r.Week != week {
					continue
				}
			}
			if id.Key == "" {
				if races > 0 {
					wins = append(wins, ranked[winRow]{winRow{r.Name, w, p, races}, h})
				}
			} else if ms := best[id.Key]; ms > 0 {
				laps = append(laps, ranked[lapRow]{lapRow{r.Name, ms}, h})
			}
		}
	})
	if !open {
		return nil
	}
	var top any
	if id.Key == "" {
		slices.SortFunc(wins, func(a, b ranked[winRow]) int {
			return cmp.Or(cmp.Compare(b.row.Wins, a.row.Wins), cmp.Compare(b.row.Podiums, a.row.Podiums),
				cmp.Compare(b.row.Races, a.row.Races), cmp.Compare(a.row.Name, b.row.Name), cmp.Compare(a.hash, b.hash))
		})
		top = rows(wins)
	} else {
		slices.SortFunc(laps, func(a, b ranked[lapRow]) int {
			return cmp.Or(cmp.Compare(a.row.Ms, b.row.Ms), cmp.Compare(a.row.Name, b.row.Name), cmp.Compare(a.hash, b.hash))
		})
		top = rows(laps)
	}
	b, _ := json.Marshal(struct {
		Period string `json:"period"`
		Key    string `json:"key"`
		Week   string `json:"week"`
		Top    any    `json:"top"`
	}{id.Period, id.Key, week, top})
	return b
}

// rows is the first boardSize rows, never nil (JSON [] not null).
func rows[T any](rs []ranked[T]) []T {
	out := make([]T, 0, min(len(rs), boardSize))
	for _, r := range rs[:min(len(rs), boardSize)] {
		out = append(out, r.row)
	}
	return out
}

// Me is GET /api/me's body for a known pilot.
func (a statsAPI) Me(hash string) ([]byte, bool) {
	r, _, ok := a.slot.Get(hash)
	if !ok {
		return nil, false
	}
	best := r.Best
	if best == nil {
		best = map[string]int{}
	}
	b, _ := json.Marshal(struct {
		Pilot meCard `json:"pilot"`
	}{meCard{r.Name, r.Races, r.Wins, r.Podiums, r.Laps, best}})
	return b, true
}

type meCard struct {
	Name    string         `json:"name"`
	Races   int            `json:"races"`
	Wins    int            `json:"wins"`
	Podiums int            `json:"podiums"`
	Laps    int            `json:"laps"`
	Best    map[string]int `json:"best"`
}
