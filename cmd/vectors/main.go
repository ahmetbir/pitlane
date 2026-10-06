// Command vectors writes the Go-generated vectors the TypeScript port replays:
// testdata/vectors/car.json, testdata/vectors/track.json and
// client/src/track/kiyi.json. Run it from the repository root (or pass -root).
package main

import (
	"flag"
	"log"
	"os"
	"path/filepath"

	"github.com/ahmetbir/pitlane/internal/vectors"
)

func main() {
	root := flag.String("root", ".", "repository root")
	flag.Parse()
	for rel, b := range map[string][]byte{
		"testdata/vectors/car.json":   vectors.Car(),
		"testdata/vectors/track.json": vectors.Track(),
		"client/src/track/kiyi.json":  vectors.Kiyi(),
	} {
		path := filepath.Join(*root, rel)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			log.Fatal(err)
		}
		if err := os.WriteFile(path, b, 0o644); err != nil {
			log.Fatal(err)
		}
		log.Printf("%s: %d bytes", rel, len(b))
	}
}
