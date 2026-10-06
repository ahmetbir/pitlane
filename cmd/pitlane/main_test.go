package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/roomkit/metrics"
	"github.com/ahmetbir/roomkit/pilot"
	"github.com/ahmetbir/roomkit/room"
)

func TestFetchPrintsBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("pitlane_rooms 1\n")) }))
	defer srv.Close()
	var out bytes.Buffer
	if code := fetch(srv.URL, &out); code != 0 || out.String() != "pitlane_rooms 1\n" {
		t.Fatalf("%d %q", code, out.String())
	}
	if code := fetch("http://127.0.0.1:1/none", &out); code != 1 {
		t.Fatal("unreachable must exit 1")
	}
	bad := httptest.NewServer(http.NotFoundHandler())
	defer bad.Close()
	out.Reset()
	if code := fetch(bad.URL, &out); code != 1 || out.Len() != 0 {
		t.Fatalf("non-200: %d %q", code, out.String())
	}
}

// The body is capped at 1 MiB.
func TestFetchCapsBody(t *testing.T) {
	big := strings.Repeat("x", 2<<20)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte(big)) }))
	defer srv.Close()
	var out bytes.Buffer
	if code := fetch(srv.URL, &out); code != 0 || out.Len() != 1<<20 {
		t.Fatalf("%d %d", code, out.Len())
	}
}

func TestSummaryLoop(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	got := make(chan string, 4)
	go summaryLoop(ctx, metrics.New("pitlane", nil), 10*time.Millisecond, func(s string) { got <- s })
	s := <-got
	cancel()
	if !strings.HasPrefix(s, "rooms=0") {
		t.Fatalf("%q", s)
	}
}

// The process logger redacts a token however a call site passes it.
func TestLoggerRedactsTokens(t *testing.T) {
	tok := pilot.New()
	for _, format := range []string{"text", "json"} {
		var buf bytes.Buffer
		log := newLogger(format, &buf)
		log.Info("join", "who", room.Who{Name: "a", Pilot: pilot.Hash(tok), NewToken: tok},
			"hello", protocol.ClientMsg{T: "hello", Name: "a", Tok: tok}, "tok", tok)
		if strings.Contains(buf.String(), tok) || !strings.Contains(buf.String(), "join") {
			t.Fatalf("%s:\n%s", format, buf.String())
		}
	}
}
