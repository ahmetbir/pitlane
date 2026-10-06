package track

import "math"

// controlScale stretches the control polygon uniformly: the brief's raw points give a 2718 m
// lap, below the 3600-4600 m the shape test requires.
const controlScale = 1.5

// startOffset is the arc length from control point 0 to the start line (on the first straight).
const startOffset = 300.0

var kiyiControl = []pt{
	{0, 0}, {300, 0}, {520, 10}, {600, 60}, {620, 140}, {580, 210}, {500, 230}, {430, 200},
	{380, 250}, {400, 330}, {470, 370}, {560, 380}, {640, 430}, {660, 520}, {600, 580}, {480, 590},
	{330, 570}, {200, 520}, {120, 440}, {40, 400}, {-60, 380}, {-120, 300}, {-110, 160}, {-60, 50},
}

func buildKiyi() *Track {
	scaled := make([]pt, len(kiyiControl))
	for i, c := range kiyiControl {
		scaled[i] = pt{c.x * controlScale, c.z * controlScale}
	}
	pts, length := resample(catmullRom(scaled, 0.25), startOffset)
	n := len(pts)
	ds := length / float64(n)
	t := &Track{ID: "kiyi", Width: 14, Kerb: 1, Runoff: 12, Length: length, Segs: make([]Seg, n)}
	for i, p := range pts {
		a, b := pts[(i+n-1)%n], pts[(i+1)%n]
		tx, tz := b.x-a.x, b.z-a.z
		l := math.Hypot(tx, tz)
		tx, tz = tx/l, tz/l
		t.Segs[i] = Seg{X: p.x, Z: p.z, TX: tx, TZ: tz, NX: -tz, NZ: tx, S: float64(i) * ds}
	}
	for i := range t.Segs {
		a, b := t.Segs[(i+n-1)%n], t.Segs[(i+1)%n]
		cross := a.TX*b.TZ - a.TZ*b.TX
		dot := a.TX*b.TX + a.TZ*b.TZ
		t.Segs[i].K = math.Atan2(cross, dot) / (2 * ds)
	}
	for k := 1; k < 3; k++ {
		t.Sectors[k] = float64(int(math.Round(float64(k)*length/3/ds))) * ds
	}
	for k := range t.Grid {
		lat := 3.0
		if k%2 == 1 {
			lat = -3
		}
		s := length - 10 - 8*float64(k)
		x, z := t.Point(s, lat)
		sg := t.Segs[int(math.Round(s/ds))%n]
		t.Grid[k] = Pose{X: x, Z: z, H: math.Atan2(sg.TZ, sg.TX)}
	}
	t.Line, t.LineSweeps = racingLine(t.Segs, t.Width/2-1.5)
	return t
}
