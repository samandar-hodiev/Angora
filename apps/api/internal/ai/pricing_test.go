package ai

import (
	"math"
	"testing"
)

func TestPriceOfMatchesDatedSnapshots(t *testing.T) {
	exact, ok := PriceOf("openai", "gpt-4.1-mini")
	if !ok || exact.InputPerMillionUSD != 0.40 {
		t.Fatalf("gpt-4.1-mini = %+v, %v", exact, ok)
	}
	dated, ok := PriceOf("openai", "gpt-4.1-mini-2025-04-14")
	if !ok || dated != exact {
		t.Fatalf("dated snapshot = %+v, %v; want the gpt-4.1-mini price", dated, ok)
	}
	if _, ok := PriceOf("mock", ""); ok {
		t.Fatal("an unpriced model must say so")
	}
}

func TestCostUSD(t *testing.T) {
	got := CostUSD(Pricing{InputPerMillionUSD: 0.40, OutputPerMillionUSD: 1.60, AudioPerMinuteUSD: 0.006}, 1_000_000, 500_000, 120)
	if want := 0.40 + 0.80 + 0.012; math.Abs(got-want) > 1e-9 {
		t.Fatalf("cost = %v, want %v", got, want)
	}
}
