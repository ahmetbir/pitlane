package race

// rng is splitmix64: the only randomness in a race.
type rng struct{ s uint64 }

func (r *rng) next() uint64 {
	r.s += 0x9e3779b97f4a7c15
	z := r.s
	z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
	z = (z ^ (z >> 27)) * 0x94d049bb133111eb
	return z ^ (z >> 31)
}

// float returns a uniform value in [0, 1).
func (r *rng) float() float64 { return float64(r.next()>>11) / (1 << 53) }
