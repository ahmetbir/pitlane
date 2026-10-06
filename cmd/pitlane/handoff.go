package main

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/roomkit/ledger"
)

// Pitlane's side of the blue/green handover (roomkit/drain, scripts/deploy.sh):
// the store that moves between servers is the pilot stats directory, whose
// flock admits one writer.
const (
	drainEvery     = time.Second
	statsRetry     = time.Second
	defaultDrain   = 30 * time.Minute
	defaultStatsWt = 40 * time.Minute // > drainMax: an old server that never drains holds the lock until it exits
)

// statsHandoff is the drain.Handoff over the stats slot: Acquire opens the
// store under dir into slot, Release closes it (final snapshot, lock
// released; records queued before it land ahead of the snapshot), Reopen
// lets it open again after an undrain.
type statsHandoff struct {
	slot        *stats.Slot
	dir         string
	retry, wait time.Duration
}

func (h statsHandoff) Acquire(ctx context.Context) { acquireStats(ctx, h.slot, h.dir, h.retry, h.wait) }
func (h statsHandoff) Release() error              { return h.slot.Close() }
func (h statsHandoff) Reopen()                     { h.slot.Reopen() }

// acquireStats opens the store under dir into slot. While another server
// holds the directory's lock it retries every retry. After wait it logs
// "stats disabled" (scripts/deploy.sh greps for it) but keeps retrying, 30x
// slower, so stats come on whenever the lock is finally released; the slot
// keeps queueing meanwhile. A store that cannot open for another reason
// (corrupt snapshot, unwritable dir) leaves stats off for good: logged, the
// slot is closed, the game runs.
func acquireStats(ctx context.Context, slot *stats.Slot, dir string, retry, wait time.Duration) {
	deadline := time.Now().Add(wait)
	waiting, late := false, false
	for {
		st, err := stats.Open(dir, ledger.Options{})
		if err == nil {
			if slot.Set(st) {
				slog.Info("stats opened", "dir", dir)
			}
			return
		}
		if !errors.Is(err, stats.ErrLocked) {
			slog.Error("stats disabled", "err", err)
			slot.Close()
			return
		}
		if !waiting {
			waiting = true
			slog.Info("stats waiting for handoff", "dir", dir, "max", wait.String())
		}
		if !late && time.Now().After(deadline) {
			late = true
			retry *= 30
			slog.Error("stats disabled", "err", err, "retry", retry.String())
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(retry):
		}
	}
}
