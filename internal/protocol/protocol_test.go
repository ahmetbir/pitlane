package protocol

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/track"
	"github.com/ahmetbir/roomkit/room"
	"github.com/ahmetbir/roomkit/wsconn"
)

var (
	_ room.Input[Input]  = Input{}
	_ room.Acker         = Snap{}
	_ wsconn.Replaceable = Snap{}
	_ room.Msg[Input]    = ClientMsg{}
)

func TestDecodeRoundTrip(t *testing.T) {
	m, err := DecodeClient([]byte(`{"t":"create","handling":"sim","contact":"full","laps":8,"listed":false}`))
	if err != nil || m.Handling != "sim" || m.Contact != "full" || m.Laps != 8 || m.Listed == nil || *m.Listed {
		t.Fatalf("create: %+v %v", m, err)
	}
	m, err = DecodeClient([]byte(`{"t":"ready","setup":[1,2,3,4,5,6]}`))
	if err != nil || m.Setup == nil || *m.Setup != (SetupInts{1, 2, 3, 4, 5, 6}) {
		t.Fatalf("ready: %+v %v", m, err)
	}
	if m, err = DecodeClient([]byte(`{"t":"start"}`)); err != nil || m.T != TStart {
		t.Fatalf("start: %+v %v", m, err)
	}
	m, err = DecodeClient([]byte(`{"t":"in","seq":5,"th":80,"br":10,"st":-64}`))
	if err != nil {
		t.Fatal(err)
	}
	in := m.Input()
	if in != (Input{80, 10, -64}) || m.Head().Seq != 5 || m.Latch(ClientMsg{}) != m {
		t.Fatalf("in: %+v %+v", in, m.Head())
	}
	if in.Latch(Input{1, 2, 3}) != in || in.Held() != in {
		t.Fatal("Input latch/held must return the receiver")
	}
	if c := in.Car(); c.Throttle != 0.8 || c.Brake != 0.1 || c.Steer != -64.0/127 {
		t.Fatalf("car input: %+v", c)
	}
}

func TestDecodeClamps(t *testing.T) {
	m, err := DecodeClient([]byte(`{"t":"in","th":99999,"br":-5,"st":-99999}`))
	if err != nil || m.Th != 100 || m.Br != 0 || m.St != -127 {
		t.Fatalf("%+v %v", m, err)
	}
	m, err = DecodeClient([]byte(`{"t":"in","th":9223372036854775807,"st":9223372036854775807}`))
	if err != nil || m.Th != 100 || m.St != 127 || m.Input() != (Input{100, 0, 127}) {
		t.Fatalf("%+v %v", m, err)
	}
}

func TestDecodeRefuses(t *testing.T) {
	for name, s := range map[string]string{
		"unknown type": `{"t":"nope"}`,
		"empty":        `{}`,
		"bad json":     `{"t":`,
		"nan":          `{"t":"ping","ts":NaN}`,
		"huge ts":      `{"t":"ping","ts":1e999}`,
		"huge int":     `{"t":"in","th":1e999}`,
		"bad handling": `{"t":"create","handling":"x"}`,
		"bad contact":  `{"t":"create","contact":"x"}`,
		"bad laps":     `{"t":"create","laps":4}`,
		"chat 0":       `{"t":"chat"}`,
		"chat 7":       `{"t":"chat","id":7}`,
		"setup 2":      `{"t":"ready","setup":[1,2]}`,
		"setup 7":      `{"t":"ready","setup":[1,2,3,4,5,6,7]}`,
		"setup float":  `{"t":"ready","setup":[1.5,2,3,4,5,6]}`,
		"setup string": `{"t":"ready","setup":["1",2,3,4,5,6]}`,
		"setup null":   `{"t":"ready","setup":null}`,
		"setup absent": `{"t":"ready"}`,
		"seq -1":       `{"t":"in","seq":-1}`,
		"big":          `{"t":"hello","name":"` + strings.Repeat("a", MaxClientMsg) + `"}`,
	} {
		if _, err := DecodeClient([]byte(s)); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestSnapWire(t *testing.T) {
	b, err := json.Marshal(Snap{T: TSnap, Tick: 7, Phase: PhaseRacing, Clock: 100, Cars: [][11]int32{{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}}})
	if err != nil {
		t.Fatal(err)
	}
	want := `{"t":"snap","tick":7,"ack":0,"phase":"racing","clock":100,"cars":[[1,2,3,4,5,6,7,8,9,10,11]]}`
	if string(b) != want {
		t.Fatalf("%s", b)
	}
	if got := (Snap{T: TSnap}).WithAck(9).(Snap); got.Ack != 9 {
		t.Fatal("WithAck")
	}
}

func TestMessageWires(t *testing.T) {
	w := Welcome{Car: 4, Handling: "arcade", Contact: "soft", Laps: 5, Track: "kiyi", Creator: true}
	w.T, w.You, w.Code = "welcome", 7, "K3FQ"
	for _, c := range []struct {
		v    any
		want string
	}{
		{w, `{"t":"welcome","you":7,"code":"K3FQ","car":4,"handling":"arcade","contact":"soft","laps":5,"track":"kiyi","creator":true}`},
		{LightsMsg{T: TLights, On: 3}, `{"t":"lights","on":3}`},
		{LightsMsg{T: TLights, Out: 2210}, `{"t":"lights","on":0,"out":2210}`},
		{NewLap(race.LapEvent{Car: 3, Lap: 2, Ms: 83412, Valid: true, Best: 82950}), `{"t":"lap","car":3,"lap":2,"ms":83412,"valid":true,"best":82950}`},
		{NewWing(3), `{"t":"wing","car":3}`},
		{GridMsg{T: TGrid, Cars: []GridCar{{1, "Ace", false, true}}}, `{"t":"grid","cars":[{"id":1,"name":"Ace","bot":false,"ready":true}]}`},
		{NewResults([]race.ResultRow{{Pos: 1, Car: 4, Name: "Ace", Laps: 5, TotalMs: 421300, BestMs: 83100}}),
			`{"t":"results","rows":[{"pos":1,"id":4,"name":"Ace","laps":5,"total":421300,"best":83100,"penalty":0}]}`},
	} {
		b, err := json.Marshal(c.v)
		if err != nil || string(b) != c.want {
			t.Errorf("%T: %s %v\nwant %s", c.v, b, err, c.want)
		}
	}
}

func TestEncodeCarRoundTrip(t *testing.T) {
	c := &race.Car{ID: 4, Lap: 2, S: 1834.04, Finished: true}
	c.St.X, c.St.Z, c.St.H = 123.456, -78.901, 3*math.Pi // wraps to π
	c.St.VX, c.St.VY, c.St.R, c.St.Delta = 55.5, -0.123, 0.4, -0.035
	c.St.Dmg.FrontWing = 0.7
	r := EncodeCar(c, true)
	near := func(got int32, scale, want float64) {
		t.Helper()
		if math.Abs(float64(got)/scale-want) > 0.01 {
			t.Errorf("got %v want %v", float64(got)/scale, want)
		}
	}
	near(r[1], 100, c.St.X)
	near(r[2], 100, c.St.Z)
	near(r[4], 100, c.St.VX)
	near(r[5], 100, c.St.VY)
	if math.Abs(float64(r[9])/10-c.S) > 0.05 { // s is 0.1 m
		t.Errorf("s %v", r[9])
	}
	if r[0] != 4 || r[3] != 3142 || r[8] != 2 {
		t.Errorf("row %v", r)
	}
	if r[10] != FlagBot|FlagFinished|FlagWingLost|FlagOffTrack {
		t.Errorf("flags %b", r[10])
	}
	c.St.H = -math.Pi
	if EncodeCar(c, false)[3] != 3142 {
		t.Error("−π must wrap to +π")
	}
	c.St.H, c.St.X, c.Driver.Human = math.NaN(), math.Inf(1), true
	r = EncodeCar(c, false)
	if r[3] != 0 || r[1] != math.MaxInt32 || r[10]&FlagBot != 0 {
		t.Errorf("non-finite: %v", r)
	}
}

func TestOffTrack(t *testing.T) {
	tr := track.Kiyi()
	x, z := tr.Point(100, 0)
	c := &race.Car{}
	c.St.X, c.St.Z = x, z
	if OffTrack(tr, c) {
		t.Error("centre line is on track")
	}
	x, z = tr.Point(100, tr.Width/2+tr.Kerb+2)
	c.St.X, c.St.Z = x, z
	if !OffTrack(tr, c) {
		t.Error("beyond the kerb is off track")
	}
}

func TestDecodeListedAbsentIsNil(t *testing.T) {
	m, err := DecodeClient([]byte(`{"t":"create"}`))
	if err != nil || m.Listed != nil {
		t.Fatalf("%+v %v", m, err)
	}
}

func TestDecodeBoundary(t *testing.T) {
	pad := MaxClientMsg - len(`{"t":"hello","name":""}`)
	b := []byte(`{"t":"hello","name":"` + strings.Repeat("a", pad) + `"}`)
	if len(b) != MaxClientMsg {
		t.Fatalf("len %d", len(b))
	}
	if _, err := DecodeClient(b); err != nil {
		t.Fatalf("1024 bytes: %v", err)
	}
	if _, err := DecodeClient(append(b[:len(b)-1:len(b)-1], ' ', '}')); err != ErrTooBig {
		t.Fatalf("1025 bytes: %v", err)
	}
}

func TestWelcomeTok(t *testing.T) {
	w := NewWelcome(7, "K3FQ", "tok123", 4, "arcade", "soft", 5, "kiyi", true)
	b, err := json.Marshal(w)
	want := `{"t":"welcome","you":7,"code":"K3FQ","tok":"tok123","car":4,"handling":"arcade","contact":"soft","laps":5,"track":"kiyi","creator":true}`
	if err != nil || string(b) != want {
		t.Fatalf("%s %v", b, err)
	}
}
