package stats

import (
	"reflect"
	"testing"
	"time"
)

var (
	wk41 = time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC) // 2026-W41
	wk42 = wk41.AddDate(0, 0, 7)
)

func TestWeekOf(t *testing.T) {
	for _, c := range []struct {
		at   time.Time
		want string
	}{
		{wk41, "2026-W41"},
		{time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), "2026-W01"},
		{time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC), "2026-W53"},                     // ISO year differs from the calendar year
		{time.Date(2026, 10, 12, 0, 59, 0, 0, time.FixedZone("x", 3600)), "2026-W41"}, // UTC, not local
	} {
		if got := WeekOf(c.at); got != c.want {
			t.Errorf("%v: %s want %s", c.at, got, c.want)
		}
	}
}

func TestKeyAndEmpty(t *testing.T) {
	s := Schema{}
	if s.Key(Delta{Pilot: "ab"}) != "ab" {
		t.Fatal("key is the pilot hash")
	}
	for _, d := range []Delta{{}, {Pilot: "a", Name: "x"}, {Wins: 1}, {BestMs: map[string]int{"kiyi": 0}}} {
		if !s.Empty(d) {
			t.Errorf("%+v is empty", d)
		}
	}
	for _, d := range []Delta{{Races: 1}, {Laps: 2}, {BestMs: map[string]int{"kiyi": 83000}}} {
		if s.Empty(d) {
			t.Errorf("%+v is not empty", d)
		}
	}
}

func TestFoldAccumulates(t *testing.T) {
	s := Schema{}
	r := s.Fold(Record{}, Delta{Name: "Ace", Races: 1, Wins: 1, Podiums: 1, Laps: 3, BestMs: map[string]int{"kiyi": 84000}}, wk41)
	r = s.Fold(r, Delta{Name: "Ace2", Races: 1, Podiums: 1, Laps: 3, BestMs: map[string]int{"kiyi": 85000}}, wk41)
	r = s.Fold(r, Delta{Races: 1, Laps: 1, BestMs: map[string]int{"kiyi": 83000}}, wk41)
	want := Record{Name: "Ace2", Races: 3, Wins: 1, Podiums: 2, Laps: 7, Best: map[string]int{"kiyi": 83000},
		Week: "2026-W41", WeekRaces: 3, WeekWins: 1, WeekPodiums: 2, WeekBest: map[string]int{"kiyi": 83000}}
	if !reflect.DeepEqual(r, want) {
		t.Fatalf("%+v\nwant %+v", r, want)
	}
}

func TestFoldWeekRollover(t *testing.T) {
	s := Schema{}
	r := s.Fold(Record{}, Delta{Races: 1, Wins: 1, Podiums: 1, BestMs: map[string]int{"kiyi": 83000}}, wk41)
	r = s.Fold(r, Delta{Races: 1, BestMs: map[string]int{"kiyi": 90000}}, wk42)
	if r.Week != "2026-W42" || r.WeekRaces != 1 || r.WeekWins != 0 || r.WeekPodiums != 0 || r.WeekBest["kiyi"] != 90000 {
		t.Fatalf("week fields restart: %+v", r)
	}
	if r.Races != 2 || r.Wins != 1 || r.Best["kiyi"] != 83000 {
		t.Fatalf("totals survive: %+v", r)
	}
	r = s.Fold(r, Delta{Races: 1, Wins: 1}, wk41) // clock stepped back: all-time only
	if r.Week != "2026-W42" || r.WeekWins != 0 || r.Wins != 2 {
		t.Fatalf("older week: %+v", r)
	}
}

func TestFoldIsDeterministicAndDoesNotAliasMaps(t *testing.T) {
	s := Schema{}
	d := Delta{Races: 1, BestMs: map[string]int{"kiyi": 80000}}
	a := s.Fold(Record{}, d, wk41)
	b := s.Fold(a, Delta{Races: 1, BestMs: map[string]int{"kiyi": 70000}}, wk41)
	if a.Best["kiyi"] != 80000 || a.WeekBest["kiyi"] != 80000 || b.Best["kiyi"] != 70000 {
		t.Fatalf("the earlier record changed: %+v %+v", a, b)
	}
	d.BestMs["kiyi"] = 1
	if a.Best["kiyi"] != 80000 {
		t.Fatal("the record aliases the delta's map")
	}
	if !reflect.DeepEqual(s.Fold(Record{}, Delta{Races: 1, BestMs: map[string]int{"kiyi": 80000}}, wk41), a) {
		t.Fatal("same input, different record")
	}
}

func TestFoldExplicitWeekWins(t *testing.T) {
	r := Schema{}.Fold(Record{}, Delta{Races: 1, Week: "2026-W10"}, wk41)
	if r.Week != "2026-W10" {
		t.Fatal(r.Week)
	}
}

func TestKeep(t *testing.T) {
	s := Schema{}
	if s.Keep(Record{Races: 9, Podiums: 3, Laps: 20}) || !s.Keep(Record{Wins: 1}) || !s.Keep(Record{Best: map[string]int{"kiyi": 1}}) {
		t.Fatal("keep: wins or any best")
	}
}

func TestStoreRoundTrip(t *testing.T) {
	dir := t.TempDir()
	st, err := Open(dir, ledgerOpts(wk41))
	if err != nil {
		t.Fatal(err)
	}
	st.Record(Delta{Pilot: "aa", Name: "Ace", Races: 1, Wins: 1, BestMs: map[string]int{"kiyi": 83000}})
	st.Record(Delta{Pilot: "", Races: 1}) // no pilot: bots never
	st.Record(Delta{Pilot: "bb", Name: "only a name"})
	if err := st.Close(); err != nil {
		t.Fatal(err)
	}
	st, err = Open(dir, ledgerOpts(wk41))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	r, _, ok := st.Get("aa")
	if !ok || r.Wins != 1 || r.Best["kiyi"] != 83000 || r.Week != "2026-W41" {
		t.Fatalf("%+v %v", r, ok)
	}
	if _, _, ok := st.Get("bb"); ok {
		t.Fatal("a name alone is not recorded")
	}
	if _, _, ok := st.Get(""); ok {
		t.Fatal("pilot \"\" is not recorded")
	}
}
