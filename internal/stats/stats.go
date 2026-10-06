// Package stats is Pitlane's schema on roomkit/ledger: per pilot races,
// wins, podiums, laps and the best valid lap per track, all-time and for the
// current ISO week. Best laps are keyed by track and handling ("kiyi-arcade").
package stats

import (
	"fmt"
	"maps"
	"time"

	"github.com/ahmetbir/roomkit/ledger"
)

// Delta is one finished race of one pilot.
type Delta struct {
	Pilot   string         `json:"p"`
	Name    string         `json:"n,omitempty"`
	Races   int            `json:"r,omitempty"`
	Wins    int            `json:"w,omitempty"`
	Podiums int            `json:"d,omitempty"`
	Laps    int            `json:"l,omitempty"`
	BestMs  map[string]int `json:"b,omitempty"` // "track-handling" → best valid lap, ms
	Week    string         `json:"k,omitempty"` // "2026-W41"; empty = the week of the record time
}

// Record is what accumulates per pilot. The Week* fields belong to Week and
// restart when a later week folds in.
type Record struct {
	Name        string         `json:"name"`
	Races       int            `json:"races"`
	Wins        int            `json:"wins"`
	Podiums     int            `json:"podiums"`
	Laps        int            `json:"laps"`
	Best        map[string]int `json:"best,omitempty"`
	Week        string         `json:"week,omitempty"`
	WeekRaces   int            `json:"wraces,omitempty"`
	WeekWins    int            `json:"wwins,omitempty"`
	WeekPodiums int            `json:"wpodiums,omitempty"`
	WeekBest    map[string]int `json:"wbest,omitempty"`
}

// Ledger types for Pitlane.
type (
	Slot  = ledger.Slot[Delta, Record]
	Store = ledger.Store[Delta, Record]
)

// ErrLocked: another server holds the stats directory.
var ErrLocked = ledger.ErrLocked

func NewSlot() *Slot { return ledger.NewSlot[Delta, Record]() }

func Open(dir string, o ledger.Options) (*Store, error) {
	return ledger.Open[Delta, Record](dir, Schema{}, o)
}

// WeekOf is the ISO year-week of t (UTC), e.g. "2026-W41".
func WeekOf(t time.Time) string {
	y, w := t.UTC().ISOWeek()
	return fmt.Sprintf("%04d-W%02d", y, w)
}

// Schema implements ledger.Schema and ledger.Keeper.
type Schema struct{}

var (
	_ ledger.Schema[Delta, Record] = Schema{}
	_ ledger.Keeper[Record]        = Schema{}
)

func (Schema) Key(d Delta) string { return d.Pilot }

// Empty: a name change alone is not recorded.
func (Schema) Empty(d Delta) bool {
	return d.Races == 0 && d.Laps == 0 && !hasBest(d.BestMs)
}

func hasBest(m map[string]int) bool {
	for _, ms := range m {
		if ms > 0 {
			return true
		}
	}
	return false
}

// Fold adds d to r. The week comes from d, else from at, so a replay is exact.
func (Schema) Fold(r Record, d Delta, at time.Time) Record {
	wk := d.Week
	if wk == "" {
		wk = WeekOf(at)
	}
	if d.Name != "" {
		r.Name = d.Name
	}
	r.Races += d.Races
	r.Wins += d.Wins
	r.Podiums += d.Podiums
	r.Laps += d.Laps
	r.Best = better(r.Best, d.BestMs)
	if wk > r.Week { // a new week restarts the week's numbers
		r.Week, r.WeekRaces, r.WeekWins, r.WeekPodiums, r.WeekBest = wk, 0, 0, 0, nil
	}
	if wk == r.Week { // an older week's delta (clock step back) counts all-time only
		r.WeekRaces += d.Races
		r.WeekWins += d.Wins
		r.WeekPodiums += d.Podiums
		r.WeekBest = better(r.WeekBest, d.BestMs)
	}
	return r
}

// better returns a copy of cur with every positive lap of in that beats it.
func better(cur, in map[string]int) map[string]int {
	if !hasBest(in) {
		return cur
	}
	out := maps.Clone(cur)
	if out == nil {
		out = map[string]int{}
	}
	for track, ms := range in {
		if ms > 0 && (out[track] == 0 || ms < out[track]) {
			out[track] = ms
		}
	}
	return out
}

// Keep: leaderboard holders outlive the rest at the key cap.
func (Schema) Keep(r Record) bool { return r.Wins > 0 || len(r.Best) > 0 }
