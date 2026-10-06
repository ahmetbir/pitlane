package protocol

import (
	"regexp"
	"testing"

	"github.com/ahmetbir/roomkit/netproto"
)

func TestNoticeCodesDoNotCollide(t *testing.T) {
	shape := regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)
	seen := map[string]bool{}
	for _, c := range append(netproto.ErrorCodes(), netproto.APICodes()...) {
		seen[c] = true
	}
	for _, c := range append(NoticeCodes(), RefusalCodes()...) {
		if !shape.MatchString(c) {
			t.Errorf("code %q has a bad shape", c)
		}
		if seen[c] {
			t.Errorf("code %q is taken", c)
		}
		seen[c] = true
	}
}
