package main

import (
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	rows, err := Parse(strings.NewReader("\ufeffheadword,pos,CEFR,CoreInventory\ncolour/color,noun,A1,x\nrun,verb,a1,\nodd,adjective,Z9,\n"))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || rows[0].Headword != "colour" || rows[1].Headword != "color" || rows[2].Level != "A1" {
		t.Fatalf("rows = %+v", rows)
	}
	if _, err := Parse(strings.NewReader("word,level\nx,A1\n")); err == nil {
		t.Fatal("a file without the right columns must be refused")
	}
}
