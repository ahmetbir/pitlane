package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDefaults(t *testing.T) {
	c, err := parseFlags(nil)
	if err != nil {
		t.Fatal(err)
	}
	l := c.limits
	if c.addr != ":8080" || c.logFormat != "text" || c.maxRooms != 16 || len(c.proxies) != 0 ||
		l.MaxConns != 128 || l.MaxConnsIP != 6 || l.CreatePerMinIP != 3 || l.JoinFailPerMinIP != 10 || l.JoinPerMinIP != 20 ||
		l.MsgRate != 90 || l.MsgBurst != 120 {
		t.Fatalf("defaults: %+v", c)
	}
}

// The command line deploy/compose.yml runs.
func TestProductionFlags(t *testing.T) {
	c, err := parseFlags([]string{"-addr", ":8080", "-origin", "pitlane.example.com",
		"-public-origin=wss://pitlane.example.com", "-trust-proxy", "172.18.0.0/16", "-log", "json"})
	if err != nil {
		t.Fatal(err)
	}
	o := c.server(nil, nil)
	if len(o.TrustProxy) != 1 || len(o.Origins) != 1 || o.Origins[0] != "pitlane.example.com" || c.logFormat != "json" ||
		len(o.ConnectSrc) != 1 || o.ConnectSrc[0] != "wss://pitlane.example.com" {
		t.Fatalf("%+v", o)
	}
}

func TestBadFlags(t *testing.T) {
	for _, args := range [][]string{{"-log", "xml"}, {"-trust-proxy", "10.0.0.0/99"}, {"-nope"}, {"-max-rooms", "-1"}} {
		if _, err := parseFlags(args); err == nil {
			t.Errorf("%v accepted", args)
		}
	}
}

func TestHealthcheck(t *testing.T) {
	ok := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) }))
	defer ok.Close()
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) }))
	defer bad.Close()
	if healthcheck(ok.URL) != 0 || healthcheck(bad.URL) != 1 || healthcheck("http://127.0.0.1:1/") != 1 {
		t.Fatal("healthcheck exit codes")
	}
}

func TestMetricsFlags(t *testing.T) {
	c, err := parseFlags([]string{"-metrics-addr", "127.0.0.1:9090", "-get", "http://x/metrics"})
	if err != nil || c.metricsAddr != "127.0.0.1:9090" || c.get != "http://x/metrics" {
		t.Fatalf("%v %+v", err, c)
	}
	if c, _ := parseFlags(nil); c.metricsAddr != "" || c.get != "" {
		t.Fatal("metrics listener is off by default")
	}
}

func TestStatsFlags(t *testing.T) {
	c, err := parseFlags(nil)
	if err != nil || c.dataDir != "" || c.statsWait != defaultStatsWt || c.server(nil, nil).Stats != nil {
		t.Fatalf("%+v %v", c, err)
	}
	c, err = parseFlags([]string{"-data", "/x", "-stats-wait", "5s"})
	if err != nil || c.dataDir != "/x" || c.statsWait.String() != "5s" {
		t.Fatalf("%+v %v", c, err)
	}
	if _, err = parseFlags([]string{"-stats-wait", "0"}); err == nil {
		t.Fatal("-stats-wait 0 must be refused")
	}
}
