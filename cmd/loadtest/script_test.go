package main

import (
	"encoding/json"
	"testing"

	"github.com/ahmetbir/pitlane/internal/protocol"
)

func wire(t *testing.T, v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestScriptMessages(t *testing.T) {
	d := driver{create: protocol.ClientMsg{T: protocol.TCreate, Handling: "arcade", Contact: "soft", Laps: 3}}
	for got, want := range map[string]string{
		wire(t, d.Hello(2)):                    `{"t":"hello","v":3,"name":"lt2"}`,
		wire(t, d.Create()):                    `{"t":"create","handling":"arcade","contact":"soft","laps":3}`,
		wire(t, d.Input(0, 0)):                 `{"t":"in","th":100}`,
		wire(t, d.Input(0, 141)):               `{"t":"in","seq":141,"th":100,"st":59}`,
		wire(t, d.React(0, 0, "welcome", nil)): `{"t":"ready","setup":[6,6,58,3,5,5,1,1]}`,
	} {
		if got != want {
			t.Errorf("got %s want %s", got, want)
		}
	}
	if d.React(0, 0, "grid", nil) != nil {
		t.Error("only welcome is answered")
	}
}

func TestParseFlags(t *testing.T) {
	if _, err := parseFlags(nil); err != nil {
		t.Fatal(err)
	}
	for _, a := range [][]string{{"-players", "0"}, {"-players", "99"}, {"-url", "http://x"}} {
		if _, err := parseFlags(a); err == nil {
			t.Errorf("%v accepted", a)
		}
	}
}
