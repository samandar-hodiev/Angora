package admin

import "testing"

func TestClassifyContentActions(t *testing.T) {
	cases := []struct {
		action             string
		meta               map[string]any
		area, kind, method string
	}{
		{ActionGrammarGenerated, nil, "grammar", "generated", "ai"},
		{ActionGrammarRefined, map[string]any{"action": "regenerate"}, "grammar", "regenerated", "ai"},
		{ActionGrammarContentSaved, nil, "grammar", "edited", "manual"},
		{ActionGrammarContentDeleted, nil, "grammar", "deleted", "manual"},
		{ActionLexiconGenerated, map[string]any{"area": "phrases", "method": "ai"}, "phrases", "generated", "ai"},
		{ActionLexiconCreated, map[string]any{"area": "collocations", "method": "manual"}, "collocations", "created", "manual"},
	}
	for _, tc := range cases {
		meta := tc.meta
		if meta == nil {
			meta = map[string]any{}
		}
		area, kind, method, ok := classify(tc.action, meta)
		if !ok || area != tc.area || kind != tc.kind || method != tc.method {
			t.Errorf("%s = %s/%s/%s (%v), want %s/%s/%s", tc.action, area, kind, method, ok, tc.area, tc.kind, tc.method)
		}
	}
	if _, _, _, ok := classify("auth.logged_in", map[string]any{}); ok {
		t.Error("a sign-in is not a content change")
	}
}

func TestTallyCountsRegenerationsAsAI(t *testing.T) {
	var c ActivityCounts
	tally(&c, "regenerated", "ai")
	tally(&c, "generated", "ai")
	tally(&c, "edited", "manual")
	tally(&c, "deleted", "manual")
	if c.Total != 4 || c.AI != 2 || c.Regenerated != 1 || c.Manual != 2 || c.Deleted != 1 {
		t.Fatalf("counts = %+v", c)
	}
}
