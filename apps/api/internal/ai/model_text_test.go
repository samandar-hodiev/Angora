package ai

import (
	"encoding/json"
	"testing"
)

func TestCleanModelJSONRestoresApostrophes(t *testing.T) {
	cases := map[string]string{
		"raw DEL":     "{\"t\":\"o\x7fqituvchi to\x7fg\x7fri\"}",
		"escaped DEL": `{"t":"o\u007fqituvchi to\u007Fg\u007fri"}`,
	}
	for name, in := range cases {
		var out struct{ T string }
		if err := json.Unmarshal(cleanModelJSON([]byte(in)), &out); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if out.T != "o'qituvchi to'g'ri" {
			t.Errorf("%s: got %q", name, out.T)
		}
	}
	clean := []byte(`{"t":"Don't"}`)
	if got := cleanModelJSON(clean); string(got) != string(clean) {
		t.Errorf("clean text changed: %s", got)
	}
}
