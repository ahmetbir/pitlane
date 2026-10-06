package race

// Contact selects how cars interact when they touch.
type Contact uint8

const (
	Ghost Contact = iota
	Soft
	Full
)

var contactNames = [...]string{"ghost", "soft", "full"}

func ParseContact(s string) (Contact, bool) {
	for i, n := range contactNames {
		if n == s {
			return Contact(i), true
		}
	}
	return Ghost, false
}

func (c Contact) String() string {
	if int(c) < len(contactNames) {
		return contactNames[c]
	}
	return "ghost"
}

// Phase is the stage of a session.
type Phase uint8

const (
	Grid Phase = iota
	Lights
	Racing
	Finish
	Results
)

var phaseNames = [...]string{"grid", "lights", "racing", "finish", "results"}

func (p Phase) String() string {
	if int(p) < len(phaseNames) {
		return phaseNames[p]
	}
	return "grid"
}

const (
	tps             = 60
	botGridTicks    = 10 * tps
	humanGridTicks  = 30 * tps
	lightTicks      = 1 * tps
	lightCount      = 5
	finishMaxTicks  = 45 * tps
	resultsTicks    = 15 * tps
	jumpStartMeters = 0.5
	jumpStartPenMs  = 5000
	numCars         = 10
	resetSpeed      = 1.0                // m/s: slower than this counts towards a marshal reset
	resetTicks      = 5 * tps            // consecutive slow racing ticks before the reset
	resetBehind     = 80.0               // m: a moving car this close behind holds a reset
	resetAhead      = 6.0                // m: any car this close ahead holds a reset
	drivableCos     = 0.7071067811865476 // cos 45°: heading within this of the track direction is drivable
)
