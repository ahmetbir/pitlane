// Command pitlane serves the game client and the multiplayer WebSocket.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ahmetbir/pitlane/internal/front"
	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/pitlane/internal/track"
	"github.com/ahmetbir/roomkit/drain"
	"github.com/ahmetbir/roomkit/metrics"
	"github.com/ahmetbir/roomkit/pilot"
)

//go:embed all:web
var web embed.FS

// version is stamped at build time: -ldflags "-X main.version=...".
var version = "dev"

const (
	shutdownGrace = 9 * time.Second // SIGTERM to exit, under compose's 10 s stop timeout
	healthTimeout = 2 * time.Second
	fetchLimit    = 1 << 20 // -get prints at most this much body
	summaryEvery  = time.Minute
	metricsGrace  = time.Second // an in-flight scrape may finish on shutdown
)

func main() {
	cfg, err := parseFlags(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	switch {
	case cfg.showVersion:
		fmt.Println(version)
		return
	case cfg.healthcheck != "":
		os.Exit(healthcheck(cfg.healthcheck))
	case cfg.get != "":
		os.Exit(fetch(cfg.get, os.Stdout))
	}
	slog.SetDefault(newLogger(cfg.logFormat, os.Stderr))
	if err := run(cfg); err != nil {
		slog.Error("pitlane", "err", err)
		os.Exit(1)
	}
}

// newLogger is the process logger; no raw pilot token can pass it.
func newLogger(format string, w io.Writer) *slog.Logger {
	var h slog.Handler = slog.NewTextHandler(w, nil)
	if format == "json" {
		h = slog.NewJSONHandler(w, nil)
	}
	return slog.New(pilot.Redact(h))
}

func run(cfg config) error {
	sigctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, quit := context.WithCancel(sigctx) // quit: a finished drain stops like SIGTERM
	defer quit()

	sub, err := fs.Sub(web, "web")
	if err != nil {
		return err
	}
	track.Kiyi()             // the racing line takes ~0.8 s to build: before the first room needs it
	var st *stats.Slot       // nil = stats off (no -data)
	var sink match.StatsSink // only a non-nil slot: no typed-nil interface
	var dropped func() uint64
	if cfg.dataDir != "" {
		st = stats.NewSlot() // opened by the drain actor: it may wait for the old server's lock
		sink, dropped = st, st.Dropped
	}
	reg := metrics.New("pitlane", dropped)
	msrv, err := serveMetrics(cfg.metricsAddr, reg)
	if err != nil {
		return err
	}
	lb := match.NewLobby(ctx, cfg.maxRooms, reg, sink)
	o := cfg.server(sub, st)
	o.Metrics = reg
	h := front.NewServer(lb, o)
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGUSR1, syscall.SIGUSR2)
	defer signal.Stop(sig)
	var ho drain.Handoff // only a non-nil slot: no typed-nil interface
	if st != nil {
		ho = statsHandoff{slot: st, dir: cfg.dataDir, retry: statsRetry, wait: cfg.statsWait}
	}
	d := drain.New(h, ho, quit, drain.Options{Every: drainEvery, Max: cfg.drainMax})
	drainDone := make(chan struct{})
	go func() { defer close(drainDone); d.Run(ctx, sig) }()
	srv := &http.Server{
		Addr:              cfg.addr,
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelError), // handler panics
	}
	shutdownDone := make(chan struct{})
	go func() {
		defer close(shutdownDone)
		<-ctx.Done()
		slog.Info("pitlane stopping")
		deadline, cancel := context.WithTimeout(context.Background(), shutdownGrace)
		defer cancel()
		if err := srv.Shutdown(deadline); err != nil {
			slog.Error("shutdown", "err", err)
		}
		// Rooms stop on ctx; sockets finish their close handshakes.
		drained := make(chan struct{})
		go func() { lb.Wait(); h.Wait(); close(drained) }()
		select {
		case <-drained:
		case <-deadline.Done():
			slog.Error("shutdown", "err", "rooms or sockets still open at the deadline")
		}
		// After the rooms: their results are in the store's queue.
		<-drainDone // no store opens after this Close
		if st != nil {
			if err := st.Close(); err != nil {
				slog.Error("stats close", "err", err)
			}
		}
		if msrv != nil {
			mctx, mcancel := context.WithTimeout(context.Background(), metricsGrace)
			defer mcancel()
			if err := msrv.Shutdown(mctx); err != nil {
				slog.Error("metrics shutdown", "err", err)
			}
		}
	}()
	go summaryLoop(ctx, reg, summaryEvery, func(s string) { slog.Info("stats", "summary", s) })
	slog.Info("pitlane listening", "addr", cfg.addr, "version", version, "origin", cfg.origin,
		"trust_proxy", cfg.trustProxy, "max_rooms", cfg.maxRooms, "max_conns", cfg.limits.MaxConns,
		"max_conns_ip", cfg.limits.MaxConnsIP, "stats", st != nil, "metrics_addr", cfg.metricsAddr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		// No room ran, but a just-opened journal still gets its final
		// snapshot (a store opening later is closed by the closed slot) and
		// the metrics listener stops (later Closes are no-ops).
		if st != nil {
			_ = st.Close()
		}
		if msrv != nil {
			_ = msrv.Close()
		}
		return err
	}
	<-shutdownDone
	slog.Info("pitlane stopped")
	return nil
}

// serveMetrics starts the metrics listener on addr ("" = none). It binds
// before returning, so a bad address fails the start instead of vanishing.
func serveMetrics(addr string, reg *metrics.Registry) (*http.Server, error) {
	if addr == "" {
		return nil, nil
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("-metrics-addr: %w", err)
	}
	srv := &http.Server{
		Handler:           metrics.Handler(reg),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    8 << 10,
		ErrorLog:          slog.NewLogLogger(slog.Default().Handler(), slog.LevelError),
	}
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("metrics listener", "err", err)
		}
	}()
	return srv, nil
}

// summaryLoop logs reg's one-line summary every interval until ctx ends.
func summaryLoop(ctx context.Context, reg *metrics.Registry, every time.Duration, log func(string)) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			log(reg.Summary())
		}
	}
}

// healthcheck GETs url and returns the process exit code: 0 on 200.
// Distroless images have no curl, so compose runs the binary itself.
func healthcheck(url string) int { return fetch(url, io.Discard) }

// fetch GETs url, copies at most fetchLimit bytes of a 200 body to w and
// returns the process exit code: 0 on 200, else 1 (reason on stderr). It is
// -get: distroless has no curl, so `docker exec` runs the binary itself.
func fetch(url string, w io.Writer) int {
	c := http.Client{Timeout: healthTimeout}
	res, err := c.Get(url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintln(os.Stderr, res.Status)
		return 1
	}
	if _, err := io.Copy(w, io.LimitReader(res.Body, fetchLimit)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	return 0
}
