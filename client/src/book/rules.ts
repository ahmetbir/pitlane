// Race rules the driver's manual quotes, as the Go server and the race page
// have them. book.test.ts reads internal/race, internal/car and ui/app.ts and
// compares every entry, so a change on either side fails the tests until the
// manual agrees.
export const RULES = {
  humanGridS: 30,     // race.humanGridTicks: the lights come on this long after the first driver joined
  lightCount: 5,      // race.lightCount
  lightS: 1,          // race.lightTicks: one light per second
  jumpStartM: 0.5,    // race.jumpStartMeters: moving this far off the slot under the lights
  jumpStartPenS: 5,   // race.jumpStartPenMs
  offTrackS: 2,       // race.maxOffTicks: longer with all four wheels off invalidates the lap
  resetSpeed: 1,      // race.resetSpeed (m/s)
  resetS: 5,          // race.resetTicks: this long slow and not drivable → marshals
  drivableDeg: 45,    // race.drivableCos = cos 45°: a heading further off the track direction is not drivable
  holdMaxS: 10,       // race.holdMax: a reset waits for traffic this long at most
  dropBackM: 200,     // race.dropBack: how far back a reset may put the car
  finishWindowS: 45,  // race.finishMaxTicks
  lapCapS: 240,       // race.lapCapTicks: a race lasts laps × this at most
  resultsS: 15,       // race.resultsTicks
  reconnectS: 60,     // race.reconnectTicks
  cars: 10,           // race.numCars
  wingLost: 0.6,      // car.wingLost: front wing damage above this and the wing is gone
  lostWingCL: 0.3,    // car.lostWingCL: front downforce left without the wing
  suspLoss: 0.15,     // car.suspLoss: grip lost with the suspension fully damaged
  idleLeaveS: 300,    // ui/app.ts IDLE_LEAVE_S
} as const;
