package track

// racingLine returns a lateral offset per seg (left +) inside ±limit. It seeds a line that
// leans toward the inside of corners, then relaxes it to minimise the summed squared curvature
// of the offset curve (projected coordinate descent), which opens up the radius of every corner
// (wide entry, inside apex, wide exit) instead of hugging the inside kerb.
func racingLine(segs []Seg, limit float64) []float64 {
	const c = 40.0
	n := len(segs)
	clamp := func(v float64) float64 { return max(-limit, min(limit, v)) }
	line, next := make([]float64, n), make([]float64, n)
	for it := 0; it < 200; it++ {
		for i := range line {
			next[i] = clamp(0.5*line[i] + 0.25*(line[(i+n-1)%n]+line[(i+1)%n]) + c*segs[i].K)
		}
		line, next = next, line
	}

	ds := segs[1].S - segs[0].S
	inv := 1 / (ds * ds)
	kappa := func(i int) float64 { // linearised curvature of the offset curve
		k := segs[i].K
		return k + k*k*line[i] + (line[(i+1)%n]-2*line[i]+line[(i+n-1)%n])*inv
	}
	for sweep := 0; sweep < 20000; sweep++ {
		for j := 0; j < n; j++ {
			a, b := (j+n-1)%n, (j+1)%n
			cj := segs[j].K*segs[j].K - 2*inv
			g := inv*kappa(a) + cj*kappa(j) + inv*kappa(b)
			h := 2*inv*inv + cj*cj
			line[j] = clamp(line[j] - g/h)
		}
	}

	for it := 0; it < 20; it++ {
		for i := range line {
			next[i] = 0.5*line[i] + 0.25*(line[(i+n-1)%n]+line[(i+1)%n])
		}
		line, next = next, line
	}
	return line
}
