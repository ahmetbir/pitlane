// Command loadtest drives simulated Pitlane drivers over WebSocket and
// reports per-second throughput, snapshot timing and disconnects.
//
// Each driver does the real handshake (hello, then create / join / quick),
// readies up on the welcome, sends 60 Hz inputs with a weaving steer, pings
// once a second and reads every server message.
//
// Per-address limits: the server allows 6 sockets, 3 room creations and
// 20 joins per address per minute. From one machine, run it only against
// a TEST instance started with raised limits, e.g.
//
//	pitlane -max-conns-ip 1000 -max-conns 1000 -create-per-min-ip 1000 \
//	        -join-per-min-ip 1000 -join-fail-per-min-ip 1000 -max-rooms 64
//
// on a private network next to the load test. Never point it at the
// production instance (or through Cloudflare): its limits refuse it.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/roomkit/loadtest"
)

type config struct {
	url                           string
	players, rooms                int
	handling, contact             string
	laps                          int
	duration, ramp, settle, every time.Duration
}

func parseFlags(args []string) (config, error) {
	var c config
	fl := flag.NewFlagSet("loadtest", flag.ContinueOnError)
	fl.StringVar(&c.url, "url", "ws://127.0.0.1:8080/ws", "game socket URL, ws:// or wss:// (empty path = /ws)")
	fl.IntVar(&c.players, "players", 4, "simulated drivers")
	fl.IntVar(&c.rooms, "rooms", 1, "rooms the drivers are spread over, round-robin; the first driver of each creates it (0 = quick play)")
	fl.StringVar(&c.handling, "handling", "arcade", "room handling: arcade|sim")
	fl.StringVar(&c.contact, "contact", "soft", "room contact: ghost|soft|full")
	fl.IntVar(&c.laps, "laps", 3, "laps: 3|5|8")
	fl.DurationVar(&c.duration, "duration", 60*time.Second, "run time after the ramp")
	fl.DurationVar(&c.ramp, "ramp", 10*time.Second, "drivers connect evenly over this time")
	fl.DurationVar(&c.settle, "settle", 5*time.Second, "after the ramp, time excluded from the steady-state summary")
	fl.DurationVar(&c.every, "every", time.Second, "report interval")
	if err := fl.Parse(args); err != nil {
		return c, err
	}
	if c.players < 1 || c.rooms < 0 || c.duration <= 0 || c.ramp < 0 || c.every <= 0 {
		return c, fmt.Errorf("need -players >= 1, -rooms >= 0, -duration > 0, -ramp >= 0, -every > 0")
	}
	if per := loadtest.HumansPerRoom(c.players, c.rooms); per > match.Seats {
		return c, fmt.Errorf("%d drivers per room exceed the grid's %d seats", per, match.Seats)
	}
	u, err := loadtest.WSURL(c.url)
	if err != nil {
		return c, fmt.Errorf("-url: %v", err)
	}
	c.url = u
	return c, nil
}

// create is the create message the flags describe; the server validates it.
func (c config) create() protocol.ClientMsg {
	return protocol.ClientMsg{T: protocol.TCreate, Handling: c.handling, Contact: c.contact, Laps: c.laps}
}

func main() {
	c, err := parseFlags(os.Args[1:])
	if errors.Is(err, flag.ErrHelp) {
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "loadtest:", err)
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	fmt.Printf("loadtest: url=%s players=%d rooms=%d handling=%s contact=%s laps=%d ramp=%s duration=%s\n",
		c.url, c.players, c.rooms, c.handling, c.contact, c.laps, c.ramp, c.duration)
	err = loadtest.Run(ctx, loadtest.Config{URL: c.url, Players: c.players, Rooms: c.rooms,
		InputHz: inputHz, SnapEvery: match.SnapEvery,
		Duration: c.duration, Ramp: c.ramp, Settle: c.settle, Every: c.every},
		driver{create: c.create()})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}
