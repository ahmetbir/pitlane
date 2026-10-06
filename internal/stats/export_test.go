package stats

import (
	"time"

	"github.com/ahmetbir/roomkit/ledger"
)

func ledgerOpts(now time.Time) ledger.Options {
	return ledger.Options{Now: func() time.Time { return now }}
}
