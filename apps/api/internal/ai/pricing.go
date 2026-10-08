package ai

import "strings"

// DefaultPricing is what each model costs, in US dollars, keyed "provider/model" as the
// gateway records them. List prices at the time of writing; update them here when a provider
// changes its prices. A model missing from the table costs nothing in the reports, which is
// why every model the platform calls is listed.
var DefaultPricing = map[string]Pricing{
	"openai/gpt-4.1":                {InputPerMillionUSD: 2.00, OutputPerMillionUSD: 8.00},
	"openai/gpt-4.1-mini":           {InputPerMillionUSD: 0.40, OutputPerMillionUSD: 1.60},
	"openai/gpt-4.1-nano":           {InputPerMillionUSD: 0.10, OutputPerMillionUSD: 0.40},
	"openai/gpt-4o":                 {InputPerMillionUSD: 2.50, OutputPerMillionUSD: 10.00},
	"openai/gpt-4o-mini":            {InputPerMillionUSD: 0.15, OutputPerMillionUSD: 0.60},
	"openai/gpt-4o-mini-transcribe": {InputPerMillionUSD: 1.25, OutputPerMillionUSD: 5.00, AudioPerMinuteUSD: 0.003},
	"openai/gpt-4o-transcribe":      {InputPerMillionUSD: 2.50, OutputPerMillionUSD: 10.00, AudioPerMinuteUSD: 0.006},
	"openai/whisper-1":              {AudioPerMinuteUSD: 0.006},
}

// PriceOf is a model's price, matching a dated snapshot ("gpt-4.1-mini-2025-04-14") to its
// family when the exact name is not listed.
func PriceOf(provider, model string) (Pricing, bool) {
	key := provider + "/" + model
	if p, ok := DefaultPricing[key]; ok {
		return p, true
	}
	best, bestLen := Pricing{}, 0
	for k, p := range DefaultPricing {
		if strings.HasPrefix(key, k+"-") && len(k) > bestLen {
			best, bestLen = p, len(k)
		}
	}
	return best, bestLen > 0
}

// CostUSD is what a call (or a sum of calls) cost at a price.
func CostUSD(p Pricing, inputTokens, outputTokens int64, audioSeconds float64) float64 {
	return float64(inputTokens)/1e6*p.InputPerMillionUSD +
		float64(outputTokens)/1e6*p.OutputPerMillionUSD +
		audioSeconds/60*p.AudioPerMinuteUSD
}
