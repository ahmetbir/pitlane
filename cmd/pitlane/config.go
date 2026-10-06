package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net/netip"
	"strings"
	"time"

	"github.com/ahmetbir/pitlane/internal/front"
	"github.com/ahmetbir/pitlane/internal/stats"
	"github.com/ahmetbir/roomkit/server"
)

type config struct {
	addr, origin, trustProxy, publicOrigin, logFormat, healthcheck string
	dataDir                                                        string        // pilot stats directory; "" = stats off
	statsWait                                                      time.Duration // how long a starting server waits for the stats lock
	metricsAddr                                                    string        // metrics listener; "" = off
	get                                                            string        // -get URL: print the body and exit

	showVersion bool
	lag         time.Duration
	drainMax    time.Duration // a draining server exits after this at the latest
	maxRooms    int
	limits      server.Limits
	proxies     []netip.Prefix
}

func parseFlags(args []string) (config, error) {
	var c config
	d := server.DefaultLimits()
	fl := flag.NewFlagSet("pitlane", flag.ContinueOnError)
	fl.SetOutput(io.Discard)
	fl.StringVar(&c.addr, "addr", ":8080", "listen address")
	fl.DurationVar(&c.lag, "lag", 0, "artificial outbound latency, e.g. 100ms")
	fl.StringVar(&c.origin, "origin", "", "comma-separated allowed WebSocket origin hosts, e.g. pitlane.example.com (empty = same host only)")
	fl.StringVar(&c.trustProxy, "trust-proxy", "", "comma-separated CIDRs of proxies whose X-Real-IP names the client (empty = trust none)")
	fl.StringVar(&c.publicOrigin, "public-origin", "", "extra CSP connect-src sources, comma-separated, e.g. wss://pitlane.example.com (empty = 'self' only)")
	fl.StringVar(&c.logFormat, "log", "text", "log format: text|json")
	fl.BoolVar(&c.showVersion, "version", false, "print the build version and exit")
	fl.StringVar(&c.healthcheck, "healthcheck", "", "GET this URL, exit 0 on 200 else 1 (container health probe)")
	fl.StringVar(&c.metricsAddr, "metrics-addr", "", "metrics listener address, e.g. 127.0.0.1:9090; never publish it (empty = off)")
	fl.StringVar(&c.get, "get", "", "GET this URL, print the body (at most 1 MiB), exit 0 on 200 else 1")
	fl.DurationVar(&c.drainMax, "drain-max", defaultDrain, "after SIGUSR1 (drain), exit when no game socket is left or after this")
	fl.StringVar(&c.dataDir, "data", "", "directory for pilot stats (empty = stats off)")
	fl.DurationVar(&c.statsWait, "stats-wait", defaultStatsWt, "wait this long for another server to release the -data lock (blue/green handoff)")
	fl.IntVar(&c.maxRooms, "max-rooms", 16, "rooms running at once (0 = no limit)")
	fl.IntVar(&c.limits.MaxConns, "max-conns", d.MaxConns, "open game sockets, server-wide (0 = default)")
	fl.IntVar(&c.limits.MaxConnsIP, "max-conns-ip", d.MaxConnsIP, "open game sockets per client address (0 = default)")
	fl.IntVar(&c.limits.MaxConnsNet, "max-conns-net", d.MaxConnsNet, "open game sockets per IPv6 /48, all its addresses together (0 = default)")
	fl.Float64Var(&c.limits.CreatePerMinIP, "create-per-min-ip", d.CreatePerMinIP, "room creations per client address per minute (0 = default)")
	fl.Float64Var(&c.limits.JoinFailPerMinIP, "join-fail-per-min-ip", d.JoinFailPerMinIP, "failed joins per client address per minute (0 = default)")
	fl.Float64Var(&c.limits.JoinPerMinIP, "join-per-min-ip", d.JoinPerMinIP, "successful joins per client address per minute (0 = default)")
	fl.Float64Var(&c.limits.MsgRate, "msg-rate", d.MsgRate, "inbound messages per second per connection (0 = default)")
	fl.IntVar(&c.limits.MsgBurst, "msg-burst", d.MsgBurst, "inbound message burst per connection (0 = default)")
	if err := fl.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fl.SetOutput(nil)
			fl.PrintDefaults()
		}
		return c, err
	}
	if c.logFormat != "text" && c.logFormat != "json" {
		return c, fmt.Errorf("-log must be text or json, got %q", c.logFormat)
	}
	if c.drainMax <= 0 || c.statsWait <= 0 {
		return c, fmt.Errorf("-drain-max and -stats-wait must be > 0")
	}
	if c.maxRooms < 0 {
		return c, fmt.Errorf("-max-rooms must be >= 0, got %d", c.maxRooms)
	}
	var err error
	if c.proxies, err = server.ParsePrefixes(c.trustProxy); err != nil {
		return c, fmt.Errorf("-trust-proxy: %v", err)
	}
	return c, nil
}

func (c config) server(web fs.FS, st *stats.Slot) server.Options {
	return server.Options{
		Web: web, Lag: c.lag, Origins: splitList(c.origin),
		TrustProxy: c.proxies, ConnectSrc: splitList(c.publicOrigin), Limits: c.limits, Stats: front.NewStats(st),
	}
}

func splitList(s string) []string {
	var out []string
	for p := range strings.SplitSeq(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
