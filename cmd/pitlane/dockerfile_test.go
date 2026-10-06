package main

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// The reproducible build copies every top-level directory holding Go code
// the server is built from.
func TestDockerfileCopiesEveryGoDir(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("..", "..", "Dockerfile"))
	if err != nil {
		t.Fatal(err)
	}
	copied := map[string]bool{}
	for _, m := range regexp.MustCompile(`(?m)^COPY (\w+)/ `).FindAllStringSubmatch(string(b), -1) {
		copied[m[1]] = true
	}
	for _, dir := range []string{"cmd", "internal"} {
		if _, err := os.Stat(filepath.Join("..", "..", dir)); err == nil && !copied[dir] {
			t.Errorf("Dockerfile does not COPY %s/", dir)
		}
	}
}
