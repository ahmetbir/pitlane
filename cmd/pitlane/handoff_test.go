package main

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/roomkit/drain"
	"github.com/ahmetbir/roomkit/ledger"
)

func TestAcquireStatsOpensAFreshDir(t *testing.T) {
	sl := stats.NewSlot()
	acquireStats(t.Context(), sl, t.TempDir(), time.Millisecond, time.Second)
	if !sl.Ready() {
		t.Fatal("a fresh dir opens")
	}
	sl.Close()
}

// A corrupt snapshot leaves stats off and the file untouched.
func TestAcquireStatsCorruptSnapshot(t *testing.T) {
	dir := t.TempDir()
	snap := filepath.Join(dir, "snapshot.json")
	junk := []byte("{not json")
	if err := os.WriteFile(snap, junk, 0o600); err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	acquireStats(t.Context(), sl, dir, time.Millisecond, time.Second)
	if sl.Ready() || sl.Record(stats.Delta{Pilot: "aa", Races: 1}) {
		t.Fatal("a corrupt snapshot must disable stats (and not queue forever)")
	}
	if b, err := os.ReadFile(snap); err != nil || string(b) != string(junk) {
		t.Fatalf("snapshot changed or removed: %v %q", err, b)
	}
}

// The new server waits for the old server's lock and opens once it is
// released; never both at once.
func TestAcquireStatsWaitsForTheLock(t *testing.T) {
	dir := t.TempDir()
	old, err := stats.Open(dir, ledger.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	done := make(chan struct{})
	go func() { acquireStats(t.Context(), sl, dir, 5*time.Millisecond, 5*time.Second); close(done) }()
	time.Sleep(50 * time.Millisecond)
	if sl.Ready() {
		t.Fatal("opened while the old store holds the lock")
	}
	old.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("did not open after the handoff")
	}
	if !sl.Ready() {
		t.Fatal("not ready after the handoff")
	}
	sl.Close()
}

// Past the wait stats are off (logged), but the lock is still retried
// slowly: once the old store finally closes, stats come on.
func TestAcquireStatsKeepsRetryingAfterWait(t *testing.T) {
	dir := t.TempDir()
	old, err := stats.Open(dir, ledger.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	done := make(chan struct{})
	go func() { acquireStats(t.Context(), sl, dir, 2*time.Millisecond, 20*time.Millisecond); close(done) }()
	time.Sleep(80 * time.Millisecond)
	if sl.Ready() {
		t.Fatal("ready while the old store holds the lock")
	}
	old.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("did not open after the late release")
	}
	if !sl.Ready() {
		t.Fatal("stats not on after the late release")
	}
	sl.Close()
}

type fakeSrv struct {
	mu    sync.Mutex
	conns int
	flush func()
}

func (f *fakeSrv) FlushStats(context.Context) bool {
	if f.flush != nil {
		f.flush()
	}
	return true
}

func (f *fakeSrv) Drain(bool) {}
func (f *fakeSrv) Conns() int { f.mu.Lock(); defer f.mu.Unlock(); return f.conns }

type drainRig struct {
	srv  *fakeSrv
	slot *stats.Slot
	dir  string
	sig  chan os.Signal
}

// startDrainer runs the roomkit drain actor over Pitlane's stats handoff.
func startDrainer(t *testing.T, conns int) *drainRig {
	t.Helper()
	r := &drainRig{srv: &fakeSrv{conns: conns}, slot: stats.NewSlot(), dir: t.TempDir(), sig: make(chan os.Signal, 1)}
	ho := statsHandoff{slot: r.slot, dir: r.dir, retry: 5 * time.Millisecond, wait: 5 * time.Second}
	a := drain.New(r.srv, ho, func() {}, drain.Options{Every: 5 * time.Millisecond, Max: time.Hour})
	go a.Run(t.Context(), r.sig)
	t.Cleanup(func() { r.slot.Close() })
	eventually(t, r.slot.Ready, "stats open at start")
	return r
}

func eventually(t *testing.T, ok func() bool, what string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal(what)
		}
		time.Sleep(2 * time.Millisecond)
	}
}

// SIGUSR1 hands the stats flock over at once: the next server's store opens.
func TestDrainHandsOffStatsLock(t *testing.T) {
	r := startDrainer(t, 2)
	r.sig <- syscall.SIGUSR1
	eventually(t, func() bool { return !r.slot.Ready() }, "stats still open")
	var next *stats.Store
	eventually(t, func() bool { next, _ = stats.Open(r.dir, ledger.Options{}); return next != nil }, "lock not released on drain")
	next.Close()
}

// SIGUSR2 reopens the slot and acquires the (free again) lock.
func TestUndrainReacquiresStats(t *testing.T) {
	r := startDrainer(t, 1)
	r.sig <- syscall.SIGUSR1
	eventually(t, func() bool { return !r.slot.Ready() }, "stats still open")
	r.sig <- syscall.SIGUSR2
	eventually(t, r.slot.Ready, "stats not reopened")
}

// Records queued before the drain land in the store the next server opens.
func TestDrainKeepsRecordsAcrossHandoff(t *testing.T) {
	r := startDrainer(t, 1)
	r.srv.flush = func() { r.slot.Record(stats.Delta{Pilot: "aa", Name: "Ace", Races: 1, Wins: 1}) }
	r.sig <- syscall.SIGUSR1
	var next *stats.Store
	eventually(t, func() bool { next, _ = stats.Open(r.dir, ledger.Options{}); return next != nil }, "lock not released on drain")
	defer next.Close()
	if rec, _, ok := next.Get("aa"); !ok || rec.Wins != 1 {
		t.Fatalf("record lost in the handoff: %+v %v", rec, ok)
	}
}
