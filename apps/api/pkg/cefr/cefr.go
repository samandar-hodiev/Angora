// Package cefr models CEFR levels (A1..C2) with an optional "+" step, e.g. B1+.
//
// Levels are compared and averaged on a half-step numeric scale: A1 = 1, A1+ = 1.5, A2 = 2,
// ... C2 = 6. Engora only ever reports *estimated* levels; this package does not imply any
// official certification.
package cefr

import (
	"fmt"
	"math"
	"strings"
)

// Codes are the base CEFR levels in ascending order.
var Codes = []string{"A1", "A2", "B1", "B2", "C1", "C2"}

const (
	MinBase = 1
	MaxBase = 6
)

// Level is a base level (1..6) and whether it is a "+" (above the base, not yet the next).
type Level struct {
	Base int
	Plus bool
}

// Parse accepts "b1", "B1" or "B1+". C2+ does not exist.
func Parse(s string) (Level, error) {
	code := strings.ToUpper(strings.TrimSpace(s))
	plus := strings.HasSuffix(code, "+")
	code = strings.TrimSuffix(code, "+")
	for i, c := range Codes {
		if c == code {
			l := Level{Base: i + 1, Plus: plus}
			if l.Base == MaxBase && plus {
				break
			}
			return l, nil
		}
	}
	return Level{}, fmt.Errorf("%q is not a CEFR level", s)
}

// MustParse is for constants and tests.
func MustParse(s string) Level {
	l, err := Parse(s)
	if err != nil {
		panic(err)
	}
	return l
}

func (l Level) Valid() bool {
	return l.Base >= MinBase && l.Base <= MaxBase && !(l.Base == MaxBase && l.Plus)
}

// BaseCode is the level without "+", e.g. "B1" for B1+.
func (l Level) BaseCode() string {
	if l.Base < MinBase || l.Base > MaxBase {
		return ""
	}
	return Codes[l.Base-1]
}

func (l Level) String() string {
	if l.Plus {
		return l.BaseCode() + "+"
	}
	return l.BaseCode()
}

// Value is the numeric half-step value used for averaging.
func (l Level) Value() float64 {
	if l.Plus {
		return float64(l.Base) + 0.5
	}
	return float64(l.Base)
}

// FromValue rounds a numeric value down to the nearest half step (a tiny epsilon absorbs
// floating-point noise) and clamps it to A1..C2.
func FromValue(v float64) Level {
	half := math.Floor((v+1e-6)*2) / 2
	half = math.Max(MinBase, math.Min(MaxBase, half))
	base := int(math.Floor(half))
	return Level{Base: base, Plus: half-float64(base) >= 0.5 && base < MaxBase}
}

// Shift moves the base level by steps (dropping "+") and clamps to A1..C2.
func (l Level) Shift(steps int) Level {
	return Level{Base: max(MinBase, min(MaxBase, l.Base+steps))}
}

// MarshalText makes Level serialize as its code ("B1+") in JSON.
func (l Level) MarshalText() ([]byte, error) {
	if !l.Valid() {
		return nil, fmt.Errorf("invalid CEFR level %+v", l)
	}
	return []byte(l.String()), nil
}

func (l *Level) UnmarshalText(b []byte) error {
	parsed, err := Parse(string(b))
	if err != nil {
		return err
	}
	*l = parsed
	return nil
}
