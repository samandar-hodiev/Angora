package ai

import "testing"

func TestUntranslated(t *testing.T) {
	source := GeneratedGrammarLevel{
		Applicable: true, Intro: "We use can for ability.", Explanation: "Can is followed by the base verb.",
		Examples:       []GeneratedExample{{Text: "I can swim."}},
		CommonMistakes: []GeneratedMistake{{Wrong: "I can to swim.", Right: "I can swim.", Why: "No 'to' after can."}},
	}

	translated := source
	translated.Intro = "Can qobiliyat uchun ishlatiladi."
	translated.Explanation = "Can dan keyin fe'lning asosiy shakli keladi."
	translated.CommonMistakes = []GeneratedMistake{{Wrong: "I can to swim.", Right: "I can swim.", Why: "Can dan keyin 'to' kelmaydi."}}
	if untranslated(source, translated) {
		t.Error("a real translation with English examples kept as they are must pass")
	}

	if !untranslated(source, source) {
		t.Error("the source handed back unchanged must be caught")
	}

	half := translated
	half.CommonMistakes = source.CommonMistakes
	if !untranslated(source, half) {
		t.Error("a mistake explanation left in English must be caught")
	}

	refused := GeneratedGrammarLevel{Applicable: false}
	if untranslated(GeneratedGrammarLevel{}, refused) {
		t.Error("a level the model refused has no prose to check")
	}
}
