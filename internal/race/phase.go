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

// TickRate is the simulation rate in ticks per second.
const TickRate = 60

const (
	tps             = TickRate
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
	holdMax         = 10 * tps           // ticks a due reset waits for traffic; then it goes to the edge
	dropFree        = 8.0                // m: no car centre this close to a reset's drop spot
	dropStep        = 10.0               // m: drop spots tried this far apart, back from the car
	dropBack        = 200.0              // m: … up to this far
	edgeIn          = 1.5                // m: an edge drop's centre inside the asphalt edge
)
