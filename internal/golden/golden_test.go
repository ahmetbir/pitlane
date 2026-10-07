// Package golden pins Pitlane's wire behaviour: seeded races driven through
// internal/match record what each session receives, and the vectors the
// TypeScript port replays must equal what cmd/vectors would write now.
//
// Goldens are tagged with GOARCH (float results may differ across
// architectures): on another architecture only determinism is checked.
// UPDATE_GOLDEN=1 go test ./internal/golden regenerates every golden and the
// three vector files.
package golden

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"

	"github.com/ahmetbir/pitlane/internal/car"
	"github.com/ahmetbir/pitlane/internal/match"
	"github.com/ahmetbir/pitlane/internal/protocol"
	"github.com/ahmetbir/pitlane/internal/race"
	"github.com/ahmetbir/pitlane/internal/vectors"
	"github.com/ahmetbir/roomkit/room"
)

func updating() bool { return os.Getenv("UPDATE_GOLDEN") == "1" }

// goldenArch is the architecture the vectors and goldens are generated on.
const goldenArch = "arm64"

// line is one recorded message. Snapshots (a run of them between other
// messages) are one line: C messages, N bytes, one hash. Other messages are
// kept in full, except welcome (it carries a token) and big ones: hash and prefix.
type line struct {
	T string          `json:"t"`
	C int             `json:"c,omitempty"`
	N int             `json:"n"`
	H string          `json:"h,omitempty"`
	M json.RawMessage `json:"m,omitempty"`
}

type run struct {
	c, n int
	h    [sha256.Size]byte
	buf  bytes.Buffer
}

// recorder is a fake room.Outbox that keeps one ordered transcript per session.
type recorder struct {
	players []room.PlayerID
	lines   map[room.PlayerID][]line
	runs    map[room.PlayerID]*run
	results bool
}

func newRecorder() *recorder {
	return &recorder{lines: map[room.PlayerID][]line{}, runs: map[room.PlayerID]*run{}}
}

func (o *recorder) To(id room.PlayerID, v any) { o.add(id, v) }
func (o *recorder) All(v any) {
	for _, id := range o.players {
		o.add(id, v)
	}
}
func (o *recorder) Changed() {}
func (o *recorder) Snap(v room.Acker) {
	for _, id := range o.players {
		o.add(id, v.WithAck(uint32(id)*100))
	}
}

func (o *recorder) closeRun(id room.PlayerID) {
	r := o.runs[id]
	if r == nil {
		return
	}
	delete(o.runs, id)
	sum := sha256.Sum256(r.buf.Bytes())
	o.lines[id] = append(o.lines[id], line{T: "snap", C: r.c, N: r.n, H: hex.EncodeToString(sum[:8])})
}

func (o *recorder) add(id room.PlayerID, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	var h struct {
		T string `json:"t"`
	}
	if err := json.Unmarshal(b, &h); err != nil {
		panic(fmt.Sprintf("%T has no string t: %v", v, err))
	}
	if h.T == "results" {
		o.results = true
	}
	if h.T == protocol.TSnap {
		r := o.runs[id]
		if r == nil {
			r = &run{}
			o.runs[id] = r
		}
		r.c++
		r.n += len(b)
		r.buf.Write(b)
		r.buf.WriteByte('\n')
		return
	}
	o.closeRun(id)
	l := line{T: h.T, N: len(b)}
	if h.T == "welcome" || len(b) > 2048 {
		sum := sha256.Sum256(b)
		l.H = hex.EncodeToString(sum[:8])
	} else {
		l.M = b
	}
	o.lines[id] = append(o.lines[id], l)
}

func (o *recorder) bytes() []byte {
	ids := make([]room.PlayerID, 0, len(o.lines))
	for id := range o.runs {
		o.closeRun(id)
	}
	for id := range o.lines {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	var b bytes.Buffer
	for _, id := range ids {
		fmt.Fprintf(&b, "## session %d\n", id)
		for _, l := range o.lines[id] {
			j, err := json.Marshal(l)
			if err != nil {
				panic(err)
			}
			b.Write(j)
			b.WriteByte('\n')
		}
	}
	return b.Bytes()
}

// driver is a scripted human. It drives with the bot brain of its car (via the match's
// Autopilot hook), quantised to the wire like a real client's input, so it completes laps.
// A driver with wildAt > 0 takes the wheel for wildLen ticks from that tick on, held on
// full right steer: it leaves the asphalt and that lap is invalid.
type driver struct {
	wildAt int
	tick   int
}

const wildLen = 150

// input is the autopilot's input for this tick through the wire, or the wild stretch.
func (d *driver) input(auto car.Input) protocol.Input {
	d.tick++
	if d.wildAt > 0 && d.tick >= d.wildAt && d.tick < d.wildAt+wildLen {
		return protocol.Input{Th: 70, St: -127}
	}
	return protocol.WireInput(auto)
}

// maxTicks bounds a race: three laps plus the finish window fit well inside.
const maxTicks = 60 * 60 * 12

// play runs two humans and eight bots through a 3-lap race and returns the transcript.
func play(h car.Handling, contact race.Contact) []byte {
	m := match.New(race.Settings{Handling: h, Contact: contact, Laps: 3, Listed: true, Seed: 7}, nil)
	out := newRecorder()
	var ids []room.PlayerID
	for _, name := range []string{"Ace", "Bee"} {
		id, err := m.Join(room.Who{Name: name})
		if err != nil {
			panic(err)
		}
		out.players = append(out.players, id)
		ids = append(ids, id)
		m.Welcome(id, "GOLD", "", out)
	}
	setups := []protocol.SetupInts{{6, 6, 58, 3, 5, 5, 2}, {3, 8, 62, 2, 7, 4, 1}}
	for i, id := range ids {
		m.Handle(id, protocol.ClientMsg{T: protocol.TReady, Setup: &setups[i]}, out)
	}
	m.Handle(ids[0], protocol.ClientMsg{T: protocol.TStart}, out)
	drv := []*driver{{}, {wildAt: 6000}}
	for t := 0; t < maxTicks && !out.results; t++ {
		in := map[room.PlayerID]protocol.Input{}
		for i, id := range ids {
			in[id] = drv[i].input(m.Autopilot(id))
		}
		m.Step(in, out)
	}
	if !out.results {
		panic("race did not reach results")
	}
	return out.bytes()
}

func deterministic(t *testing.T, h car.Handling, contact race.Contact) []byte {
	t.Helper()
	a, b := play(h, contact), play(h, contact)
	if !bytes.Equal(a, b) {
		t.Fatalf("race is not deterministic (line %d differs)", firstDiff(a, b))
	}
	return a
}

func firstDiff(a, b []byte) int {
	la, lb := bytes.Split(a, []byte("\n")), bytes.Split(b, []byte("\n"))
	for i := range min(len(la), len(lb)) {
		if !bytes.Equal(la[i], lb[i]) {
			return i + 1
		}
	}
	return min(len(la), len(lb)) + 1
}

// check compares got with <path>.<arch>.golden when tagged, or path itself.
func check(t *testing.T, path string, got []byte, tagged bool) {
	t.Helper()
	file := path
	if tagged {
		file = path + "." + runtime.GOARCH + ".golden"
	}
	if updating() && (!tagged || runtime.GOARCH == goldenArch) {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, got, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	want, err := os.ReadFile(file)
	if err != nil {
		if tagged {
			if others, _ := filepath.Glob(path + ".*.golden"); len(others) > 0 {
				t.Skipf("%s: goldens exist only for %v; on %s only determinism is checked", path, others, runtime.GOARCH)
			}
		}
		t.Fatalf("%v (UPDATE_GOLDEN=1 creates it)", err)
	}
	if !bytes.Equal(got, want) {
		out := filepath.Join(os.TempDir(), "golden-actual-"+strings.ReplaceAll(path, "/", "_"))
		_ = os.WriteFile(out, got, 0o644)
		t.Fatalf("%s differs at line %d; actual written to %s", file, firstDiff(got, want), out)
	}
}

func TestRaceSoft(t *testing.T) {
	check(t, filepath.Join("testdata", "race_soft"), deterministic(t, car.Arcade, race.Soft), true)
}

func TestRaceFull(t *testing.T) {
	check(t, filepath.Join("testdata", "race_full"), deterministic(t, car.Arcade, race.Full), true)
}

func TestRaceSimSoft(t *testing.T) {
	check(t, filepath.Join("testdata", "race_sim_soft"), deterministic(t, car.Sim, race.Soft), true)
}

// TestVectorsFresh: the files on disk equal what cmd/vectors writes now. Track queries are
// FMA-safe, so track.json is recomputed from the committed kiyi.json on every architecture.
// car.json (initial headings come from math.Cos/Sin, which the arm64 assembly of the math
// package fuses differently) and kiyi.json (track construction) are checked, and written by
// UPDATE_GOLDEN, on the golden architecture only.
func TestVectorsFresh(t *testing.T) {
	root := filepath.Join("..", "..")
	kiyi := filepath.Join(root, "client", "src", "track", "kiyi.json")
	if runtime.GOARCH == goldenArch {
		check(t, filepath.Join(root, "testdata", "vectors", "car.json"), vectors.Car(), false)
		check(t, kiyi, vectors.Kiyi(), false)
	} else {
		t.Logf("car.json and kiyi.json are generated on %s; on %s they are only read", goldenArch, runtime.GOARCH)
	}
	b, err := os.ReadFile(kiyi)
	if err != nil {
		t.Fatal(err)
	}
	tj, err := vectors.TrackFromKiyi(b)
	if err != nil {
		t.Fatal(err)
	}
	check(t, filepath.Join(root, "testdata", "vectors", "track.json"), tj, false)
}
