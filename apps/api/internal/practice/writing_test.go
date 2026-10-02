package practice

import (
	"testing"

	"github.com/samandar-hodiev/engora/apps/api/internal/ai"
)

func TestRealCorrections(t *testing.T) {
	in := []ai.AssessmentMistake{
		{Original: "a apple", Correction: "an apple"},
		{Original: "a coffee", Correction: "a coffee"},
		{Original: "A  Coffee", Correction: "a coffee"},
		{Original: "an small cafe", Correction: "a small cafe"},
	}
	got := realCorrections(in)
	if len(got) != 2 || got[0].Original != "a apple" || got[1].Original != "an small cafe" {
		t.Fatalf("a correction that changes nothing must be dropped, got %+v", got)
	}
}
