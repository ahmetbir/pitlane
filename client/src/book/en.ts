// The driver's manual in English: the same structure as tr.ts. Numbers come from parts.ts (code, settings, rules).
import { ABS, TC } from "../car/car.ts";
import { keysLabel } from "../input/bindings.ts";
import { b, figure, kbd, list, note, p, steps, sub, type BookCtx, type ChapterBody } from "./kit.ts";
import { absTable, chord, F, keyOf, keyTable, pairOf, launchTable, lightsArt, padTable, RULES as R, settingName, setupTable, tcTable, z100Art } from "./parts.ts";
import type { ChapterName } from "./chapters.ts";

const start = ({ keys }: BookCtx) => [
  p(`Pitlane is multiplayer formula racing in the browser. Up to ${R.cars} cars race in a room and bots fill the empty places, so you can race at once, even alone.`),
  sub("Three ways into a race"),
  list(
    [b("Quick race"), ": takes a free seat in a room, or opens a new one (Arcade, soft contact, 3 laps)."],
    [b("Create room"), `: you pick the handling (Arcade or Sim), the contact rule (ghost, soft, full) and the laps (${F.laps}). Keep it out of the list and give the code to your friends only.`],
    [b("Join by code"), ": type the four-character code a friend gave you, or open the /r/CODE link they shared."],
  ),
  sub("From the grid to the lights"),
  steps(
    ["On the grid, open the ", b("Garage"), " and set up the car. Every change is stored in this browser at once."],
    ["Press ", b("Ready"), ": your setup goes to the server. Changed it later? Send it again with ", b("Update setup"), "."],
    [`When everyone is ready, when the room creator starts, or ${R.humanGridS} s after the first driver joined, the ${R.lightCount} lights come on one by one.`],
    ["Lights out and the race is on. For a better start, hold the revs with ", chord(keys, "launch", "throttle"), " (see Launch and start)."],
  ),
  note("tip", `Join while a race runs and you take over the last-placed bot's car. Lose the connection and you get your own car back within ${R.reconnectS} s, with your place and lap.`),
  note("warn", `Touch neither the keyboard nor a gamepad for ${F.idleMin} minutes and you leave the race and return home.`),
];

const controls = ({ keys }: BookCtx) => [
  p("Pitlane is tuned to be played on a keyboard. Every key can be changed in Settings > Controls; the table below shows your keys right now."),
  sub("Keyboard"),
  keyTable(keys),
  sub("Gamepad"),
  p(`Any gamepad with the standard mapping works (Xbox, PlayStation and the like). The moment you touch a trigger, button or stick the pad takes the car; leave it for ${F.padHoldS} s and the keyboard is back.`),
  padTable(),
  sub("Changing settings while racing"),
  p("Four settings can be changed on the track; each press moves one step and the HUD readout lights the new value. Hardware settings (wings, gearing, suspension) change in the garage only."),
  list(
    [pairOf(keys, "bbBack", "bbFwd"), ": brake bias 1 % rearward / forward."],
    [pairOf(keys, "diffDown", "diffUp"), ": differential one step more open / more locked."],
    [pairOf(keys, "tcDown", "tcUp"), ": traction control one level down / up (Sim rooms; Arcade is fixed)."],
    [pairOf(keys, "absDown", "absUp"), ": ABS one level down / up (Sim rooms; Arcade is fixed)."],
    ["On a gamepad the d-pad does it: up / down brake bias, left / right traction control. The change is stored, so the next race starts with it."],
  ),
  sub("Brake and reverse"),
  list(
    [keyOf(keys, "brake"), " is always the brake."],
    [keyOf(keys, "brakeReverse"), ` brakes while the car rolls forward. Once it stops (${F.stoppedVX()} m/s or less) it selects reverse and backs up while held, at about ${F.revKmh} km/h at most. The HUD shows gear `, b("R"), "."],
    ["With the throttle held, ", keyOf(keys, "brakeReverse"), " brakes instead of reversing. Both together while stopped make a launch hold."],
    ["Backing up, the steering works as in a real car: steer left to swing the rear to the left."],
  ),
  sub("Camera and help"),
  p(keyOf(keys, "camera"), " switches between the chase and cockpit cameras (pick the default in Settings). Hold ", keyOf(keys, "lookBack"), " to look back. In a race, ", kbd(`${keysLabel(keys.help)} / ?`), " opens the controls card."),
];

const handling = () => [
  p("Every room has a handling model. It is picked when the room is created and is the same for everyone in it; the leaderboard keeps best laps for the two models apart."),
  sub("Arcade"),
  list(
    [`The tyres grip ${F.arcadeGrip()} more.`],
    [`Traction control is always on. Its share is Sim level 3's (${F.arcadeTC()}), measured on the rear grip that cornering leaves.`],
    [`ABS is always on, at the level-1 share (${F.arcadeABS()}): each axle's brake stays within the grip cornering leaves it, so you can turn while braking.`],
    ["A stability aid limits the car's rotation; the steering reacts faster and turns less the faster you go."],
    ["Steering assist: full lock never asks for more than the front tyres' peak grip, so turning the wheel further cannot wash the nose wide."],
  ),
  sub("Sim"),
  list(
    [`Normal grip; no stability aid. You pick ABS in the garage: Off, 1, 2 or 3; the default is ${F.simDefaultABS()}. With it off, steer while braking hard and the front tyres spend all their grip on the brakes: the car goes straight on.`],
    [`You pick traction control in the garage: Off, 1, 2 or 3. The default is ${F.simDefaultTC()}.`],
    ["Steering assist: full lock asks the front tyres only for the grip the rear can match, and when the rear starts to slide the wheel follows the car (opposite lock if needed), so on a keyboard full lock turns the car instead of sliding the nose wide or spinning it."],
  ),
  sub("Traction control levels"),
  p("Traction control (TC) lets the throttle use only a share of the grip the rear tyres have left after cornering. The smaller the share, the safer the car, and the slower it accelerates."),
  tcTable(),
  figure(z100Art(), "0–100 km/h: default setup, full throttle on a straight, from idle. Sim at every TC level, and Arcade to compare. The times are measured on the car model itself."),
  sub("ABS levels"),
  p("ABS lets each axle's brake use only a share of the grip that cornering leaves it, so the car keeps turning while it slows. Off, the brakes may take all of it: hard braking in a corner locks the fronts and the car goes straight on, or spins if the rear locks."),
  absTable(),
  sub("What to expect with a keyboard"),
  list(
    [`A key is all or nothing: the throttle is full after ${F.throttleRampS()} s. With TC off that means full throttle in a corner; the rear slides and the car turns round.`],
    ["TC 1 lets the tyre work to its limit: a little slower than TC off on a straight, but even full throttle at full lock on a keyboard does not spin the car."],
    ["TC 2 and 3 are more forgiving; you pay for it out of corners and on the straights."],
    ["A gamepad trigger gives the throttle gradually; low TC in Sim is easier with a pad."],
  ),
];

const garage = () => [
  p("The garage has eight settings. Every change is stored in this browser; pressing Ready on the grid sends it to the server and you drive the race with it."),
  setupTable(),
  sub(settingName(0)),
  p("The front wing presses the front tyres down; every step also adds a little drag."),
  list([b("Raise"), ": the nose turns in more sharply."], [b("Lower"), ": a little quicker on the straights; the front washes wide in fast corners."]),
  sub(settingName(1)),
  p("The rear wing presses the rear tyres down."),
  list([b("Raise"), ": a planted rear in fast corners; lower top speed."], [b("Lower"), ": higher top speed; the rear goes light in fast corners."]),
  sub(settingName(2)),
  p("How the braking force is split between front and rear: the first number is the front."),
  list([b("Forward"), ": stable braking, but the fronts saturate early and the nose runs wide in a corner."], [b("Rearward"), ": the car rotates under braking; too far back and the rear slides."]),
  sub(settingName(3)),
  p("The gear ratios: a small number is short, a large one long."),
  list([b("Short"), ": strong acceleration; you reach the rev limit early at the end of a straight."], [b("Long"), ": higher top speed, less acceleration out of corners."]),
  sub(settingName(4)),
  p("The differential sets how much the two rear wheels turn together on the throttle: 1 is open, a large number more locked."),
  list([b("Lock"), ": better traction on exit, but the rear steps out more easily on power."], [b("Open"), ": calmer mid-corner, less traction on exit."]),
  sub(settingName(5)),
  p("How the cornering load is shared between the front and rear axles."),
  list([b("Up"), ": understeer; the car runs wide but stays safe."], [b("Down"), ": oversteer; the car turns eagerly, and the rear may go on power."]),
  sub(settingName(TC)),
  p("The levels and what they do are in the Arcade and Sim chapter. Your level applies in Sim rooms only; Arcade always runs 3."),
  list([b("Raise"), ": safer exits, slower acceleration."], [b("Lower"), ": quicker acceleration; it asks for more care on the throttle."]),
  sub(settingName(ABS)),
  p("The levels are in the Arcade and Sim chapter. Your level applies in Sim rooms only; Arcade always runs at 1."),
  list([b("Raise"), ": more stability under braking, a longer braking distance."], [b("Lower"), ": shorter braking, but a wheel may lock; Off asks for a clean line."]),
  p("Brake bias, differential, traction control and ABS can also be changed while racing (see Controls)."),
  note("tip", "Not sure? Reset to default: the default setup is a balanced start. Change one setting at a time and feel the difference."),
];

const race = () => [
  sub("Phases"),
  list(
    [b("Grid"), `: drivers set up and get ready. The lights follow when everyone is ready, when the creator starts, or ${R.humanGridS} s after the first driver joined.`],
    [b("Lights"), `: ${R.lightCount} lights come on ${R.lightS} s apart, then all go out together.`],
    [b("Race"), `: ${F.laps} laps. The first lap starts from the grid, which stands behind the line.`],
    [b("Finish"), `: once the first car has finished, the others complete the lap they are on; ${R.finishWindowS} s at most.`],
    [b("Results"), `: the table shows for ${R.resultsS} s; then the grid forms again and the damage is repaired.`],
  ),
  figure(lightsArt(), "The lights come on a second apart; when all go out, the race is on."),
  sub("Jump start"),
  p(`Move more than ${R.jumpStartM} m off your grid slot while the lights are on and ${R.jumpStartPenS} s are added to your total time. Throttle with the brake held (a launch hold) does not move the car and is no jump start.`),
  p(`The moment it happens a red banner, "${F.jumpBanner()}", shows for a few seconds and a ${F.jumpBadge()} badge stays on your HUD for the rest of the race; the other drivers see a short line with your name. The penalty also shows in the results table.`),
  sub("Laps, sectors and validity"),
  list(
    ["A lap has three sectors. On the HUD purple is the fastest in the room, green your own best, yellow slower."],
    [`Spend more than ${R.offTrackS} s in total with all four wheels off the track and the lap is invalid: it counts in the race, but not as a best lap or on the leaderboard. The HUD warns "OFF TRACK".`],
    ["Drive the wrong way and the HUD says \"WRONG WAY\"; crossing the line backwards never counts as a lap."],
  ),
  sub("Marshals"),
  p(`If your car is stuck where it cannot be driven (off the track, or more than ${R.drivableDeg}° off the track direction) and slower than ${R.resetSpeed} m/s for ${R.resetS} s, the marshals put it back on the racing line facing down the track, up to ${R.dropBackM} m back if needed. With traffic coming they wait ${R.holdMaxS} s at most. The time lost is the penalty; reversing out yourself is usually quicker.`),
  sub("Results and stats"),
  list(
    ["Finishers are ordered by laps completed and total time with penalties; the others are DNF."],
    [`If nobody finishes, the race ends after the number of laps × ${F.lapCapMin} minutes.`],
    ["Your stats: races, wins, podiums, laps and the best valid lap per handling, this week and all time. Take over a bot and only what you drive counts."],
  ),
];

const contact = () => [
  p("A room is created with one of three contact rules; a quick race opens with soft contact."),
  list(
    [b("Ghost"), ": cars pass through each other. The barriers still stop you."],
    [b("Soft"), ": cars push each other apart along their real outline (5.4 × 1.9 m); a bump costs both a little speed, leaning on each other costs none; no damage."],
    [b("Full"), ": real collisions. Hitting cars and barriers causes damage."],
  ),
  sub("Damage"),
  list(
    ["A hit on the front third of the car goes to the front wing, on the rear third to the rear wing, in the middle to the suspension. Light rubs do no damage."],
    [`Front wing damage costs front downforce. Past the limit the wing comes off (limit: ${F.wingLost()}); front downforce left: ${F.lostWingCL()}. The car understeers in corners; the HUD says "Your front wing came off!".`],
    ["Rear wing damage costs rear downforce: the rear goes light in fast corners."],
    [`Suspension damage costs up to ${F.suspLoss()} of the grip.`],
    ["Damage stays for the race; the car is repaired when the grid forms again."],
  ),
  note("tip", "With full contact, brake early: running into a car's back damages your front wing and its rear wing."),
];

const launch = ({ keys }: BookCtx) => [
  p("A launch holds the engine at the right revs while the lights are on and lets the car go at once. The brakes keep the car still, so you prepare the revs without a penalty."),
  sub("How to launch"),
  steps(
    ["While the lights are on, hold ", chord(keys, "launch", "throttle"), " (or ", chord(keys, "brake", "throttle"), "). The brakes hold the car; the engine reaches ", `${F.launchRPM} rpm in about ${F.launchRevS()} s and stays there. The HUD shows `, b("LAUNCH"), " and the rpm bar turns green."],
    ["Lights out: let go of ", keyOf(keys, "launch"), " (or ", keyOf(keys, "brake"), ") and keep ", keyOf(keys, "throttle"), " held."],
    [`The clutch slips: until the engine comes down to the wheels' revs (at ${F.launchEndKmh} km/h at the latest), traction control lets the tyre work to its limit.`],
    ["On a gamepad: hold A and press RT while stopped; let go of A when the lights go out."],
  ),
  sub("Why launch"),
  p("A launch gives back the power traction control cuts in the first metres. The gain depends on the handling and the TC level:"),
  launchTable(),
  list(
    ["Arcade, and Sim at TC 2–3: a launch gains time at every start."],
    ["Sim at TC 1: TC already lets the tyre work to its limit, so a launch adds nothing, and costs nothing."],
    ["Sim with TC off: no gain; this is the quickest on a straight, but full throttle in a corner on a keyboard slides the rear."],
  ),
  note("tip", "Hold Left Shift, or use ", chord(keys, "brake", "throttle"), ": on Windows, holding Right Shift for about 8 seconds can turn on Filter Keys."),
  note("warn", `Throttle without the brake under the lights moves the car: ${R.jumpStartM} m and it is a ${R.jumpStartPenS} s penalty. The table's times are measured on the car model with the default setup; the rev-up of about ${F.launchRevS()} s is not included.`),
];

export const EN_BOOK: Record<ChapterName, ChapterBody> = { start, controls, handling, garage, race, contact, launch };
