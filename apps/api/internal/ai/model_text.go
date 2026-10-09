package ai

import "bytes"

// cleanModelJSON repairs a character models sometimes write in place of an apostrophe.
//
// Uzbek Latin is full of apostrophes (o', g', and the tutuq belgisi in ma'no). A model
// writing it occasionally emits the DEL control character (0x7F) instead — raw or as the
// JSON escape \u007f — and the lesson then reads "o aqida" or "to ri" on the learner's
// screen. DEL never belongs in text, so every one of them is put back as an apostrophe
// before the output is decoded.
func cleanModelJSON(raw []byte) []byte {
	if !bytes.Contains(raw, []byte{0x7f}) && !bytes.Contains(bytes.ToLower(raw), []byte(`\u007f`)) {
		return raw
	}
	out := bytes.ReplaceAll(raw, []byte{0x7f}, []byte("'"))
	out = bytes.ReplaceAll(out, []byte(`\u007f`), []byte("'"))
	return bytes.ReplaceAll(out, []byte(`\u007F`), []byte("'"))
}
