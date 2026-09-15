package cefr

import (
	"encoding/json"
	"testing"
)

func TestParseAndString(t *testing.T) {
	for in, want := range map[string]string{"b1": "B1", "B1+": "B1+", " a2 ": "A2", "C2": "C2"} {
		l, err := Parse(in)
		if err != nil || l.String() != want {
			t.Errorf("Parse(%q) = %v, %v; want %s", in, l, err, want)
		}
	}
	for _, bad := range []string{"", "B3", "C2+", "B1++", "D1"} {
		if _, err := Parse(bad); err == nil {
			t.Errorf("Parse(%q) should fail", bad)
		}
	}
}

func TestValueRoundTrip(t *testing.T) {
	cases := map[float64]string{1: "A1", 1.49: "A1", 1.5: "A1+", 3.2: "B1", 3.75: "B1+", 5.99: "C1+", 6: "C2", 7.3: "C2", 0.2: "A1", 3.4999999: "B1+"}
	for v, want := range cases {
		if got := FromValue(v).String(); got != want {
			t.Errorf("FromValue(%v) = %s, want %s", v, got, want)
		}
	}
	if MustParse("B2+").Value() != 4.5 {
		t.Error("B2+ should be 4.5")
	}
}

func TestShiftClampsAndDropsPlus(t *testing.T) {
	if got := MustParse("A1+").Shift(-1).String(); got != "A1" {
		t.Errorf("A1+ - 1 = %s", got)
	}
	if got := MustParse("C1").Shift(3).String(); got != "C2" {
		t.Errorf("C1 + 3 = %s", got)
	}
}

func TestJSON(t *testing.T) {
	var v struct{ L Level }
	if err := json.Unmarshal([]byte(`{"L":"B2+"}`), &v); err != nil || v.L.String() != "B2+" {
		t.Fatalf("unmarshal: %v %v", v, err)
	}
	out, _ := json.Marshal(v)
	if string(out) != `{"L":"B2+"}` {
		t.Errorf("marshal = %s", out)
	}
}
