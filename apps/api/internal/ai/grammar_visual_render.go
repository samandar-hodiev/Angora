package ai

import (
	"fmt"
	"html"
	"math"
	"strings"
)

// Drawing grammar diagrams.
//
// The model used to write the SVG itself, coordinates and all. A language model has no
// layout engine: arrows landed on words, titles ran out of their boxes, labels were cut in
// half, and no two diagrams looked like the same product. So the work is split. The model
// says what the diagram teaches — a title, the rule, a few columns of examples, the words
// to look for — as structured data, and this file lays it out: text is wrapped to its box,
// columns are the same height, and nothing is placed on top of anything else.

// VisualSpec is what the model answers with.
type VisualSpec struct {
	// Type is "panels" (side-by-side columns: a rule, a comparison, a before/after) or
	// "timeline" (events placed before, at and after now).
	Type    string        `json:"type"`
	Title   string        `json:"title"`
	Rule    string        `json:"rule"`
	Panels  []VisualPanel `json:"panels"`
	Events  []VisualEvent `json:"events"`
	Tags    []string      `json:"tags"`
	Footer  string        `json:"footer"`
	AltText string        `json:"alt_text"`
	Caption string        `json:"caption"`
}

type VisualPanel struct {
	Heading    string       `json:"heading"`
	Subheading string       `json:"subheading"`
	Items      []VisualItem `json:"items"`
}

// VisualItem is one example. Text may mark the part being taught as **bold**.
type VisualItem struct {
	Text string `json:"text"`
	Note string `json:"note"`
}

type VisualEvent struct {
	Label string `json:"label"`
	// When is "past", "now" or "future".
	When string `json:"when"`
	Note string `json:"note"`
}

// SchemaGrammarVisual names the structured answer a visual is generated as.
const SchemaGrammarVisual = "grammar_visual"

var visualSpecSchema = []byte(`{
  "type": "object",
  "additionalProperties": false,
  "required": ["type", "title", "rule", "panels", "events", "tags", "footer", "alt_text", "caption"],
  "properties": {
    "type": {"type": "string", "enum": ["panels", "timeline"]},
    "title": {"type": "string"},
    "rule": {"type": "string"},
    "panels": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["heading", "subheading", "items"],
        "properties": {
          "heading": {"type": "string"},
          "subheading": {"type": "string"},
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["text", "note"],
              "properties": {"text": {"type": "string"}, "note": {"type": "string"}}
            }
          }
        }
      }
    },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["label", "when", "note"],
        "properties": {
          "label": {"type": "string"},
          "when": {"type": "string", "enum": ["past", "now", "future"]},
          "note": {"type": "string"}
        }
      }
    },
    "tags": {"type": "array", "items": {"type": "string"}},
    "footer": {"type": "string"},
    "alt_text": {"type": "string"},
    "caption": {"type": "string"}
  }
}`)

// Palette: the diagram is shown as an image on a light card of its own, so it reads the same
// in both themes. Colours are written out rather than referenced — an <img> has no page
// variables to resolve.
const (
	visW       = 800.0
	visPad     = 32.0
	visGap     = 20.0
	colInk     = "#0f172a"
	colMuted   = "#475569"
	colPrimary = "#047857"
	colPanel   = "#ecfdf5"
	colBorder  = "#a7d7c5"
	colCard    = "#f8fafc"
	colChip    = "#ffffff"
)

// RenderVisual lays a spec out as an SVG document. Every string from the model is escaped.
func RenderVisual(spec VisualSpec) string {
	c := &canvas{}
	y := visPad

	y = c.textBlock(spec.Title, visW/2, y, visW-2*visPad, 24, 700, colInk, "middle", 2) + 6
	if strings.TrimSpace(spec.Rule) != "" {
		y = c.textBlock(spec.Rule, visW/2, y, visW-2*visPad-40, 16, 400, colMuted, "middle", 3) + 6
	}
	y += 12

	if spec.Type == "timeline" && len(spec.Events) > 0 {
		y = c.timeline(spec.Events, y)
	} else {
		y = c.panels(spec.Panels, y)
	}

	if tags := cleanStrings(spec.Tags, 8); len(tags) > 0 {
		y = c.chips(tags, y+16)
	}
	if strings.TrimSpace(spec.Footer) != "" {
		y = c.textBlock(spec.Footer, visW/2, y+14, visW-2*visPad, 14, 400, colMuted, "middle", 2)
	}
	height := math.Ceil(y + visPad)

	var out strings.Builder
	fmt.Fprintf(&out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" color="%s" font-family="Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">`,
		int(visW), int(height), colInk)
	fmt.Fprintf(&out, "<title>%s</title>", esc(firstNonEmpty(spec.AltText, spec.Title, "Grammar diagram")))
	fmt.Fprintf(&out, `<rect x="0" y="0" width="%d" height="%d" rx="18" fill="%s"/>`, int(visW), int(height), colCard)
	out.WriteString(c.b.String())
	out.WriteString("</svg>")
	return out.String()
}

type canvas struct{ b strings.Builder }

// panels draws up to three columns of the same height and returns the y below them.
func (c *canvas) panels(panels []VisualPanel, top float64) float64 {
	if len(panels) == 0 {
		return top
	}
	if len(panels) > 3 {
		panels = panels[:3]
	}
	n := float64(len(panels))
	width := (visW - 2*visPad - (n-1)*visGap) / n
	inner := width - 36

	// Measure first, so every column can be drawn at the height of the tallest.
	heights := make([]float64, len(panels))
	for i, p := range panels {
		heights[i] = c.panelBody(p, 0, 0, inner, false)
	}
	height := 0.0
	for _, h := range heights {
		height = math.Max(height, h)
	}
	height += 40

	for i, p := range panels {
		x := visPad + float64(i)*(width+visGap)
		fmt.Fprintf(&c.b, `<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="14" fill="%s" stroke="%s"/>`,
			x, top, width, height, colPanel, colBorder)
		c.panelBody(p, x+18, top+22, inner, true)
	}
	return top + height
}

// panelBody draws (or, with draw false, only measures) one column's contents and returns
// how tall they are.
func (c *canvas) panelBody(p VisualPanel, x, top, width float64, draw bool) float64 {
	sub := canvas{}
	target := c
	if !draw {
		target = &sub
	}
	center := x + width/2
	y := top
	y = target.textBlock(p.Heading, center, y, width, 22, 700, colPrimary, "middle", 2)
	if strings.TrimSpace(p.Subheading) != "" {
		y = target.textBlock(p.Subheading, center, y+2, width, 14, 400, colMuted, "middle", 3)
	}
	y += 12
	items := p.Items
	if len(items) > 6 {
		items = items[:6]
	}
	for _, item := range items {
		if strings.TrimSpace(item.Text) == "" {
			continue
		}
		y += 6
		fmt.Fprintf(&target.b, `<circle cx="%.1f" cy="%.1f" r="3.5" fill="%s"/>`, x+4, y+11, colPrimary)
		y = target.textBlock(item.Text, x+16, y, width-16, 17, 400, colInk, "start", 3)
		if strings.TrimSpace(item.Note) != "" {
			y = target.textBlock(item.Note, x+16, y+1, width-16, 13, 400, colMuted, "start", 2)
		}
	}
	return y - top
}

// timeline draws an axis with past, now and future, and events placed in their zone.
func (c *canvas) timeline(events []VisualEvent, top float64) float64 {
	if len(events) > 6 {
		events = events[:6]
	}
	axisY := top + 70
	left, right := visPad+20, visW-visPad-20
	nowX := visW / 2
	fmt.Fprintf(&c.b, `<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="3" stroke-linecap="round"/>`,
		left, axisY, right, axisY, colBorder)
	fmt.Fprintf(&c.b, `<path d="M%.1f %.1f l-10 -6 v12 z" fill="%s"/>`, right+4, axisY, colBorder)
	fmt.Fprintf(&c.b, `<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="%s" stroke-width="2" stroke-dasharray="4 4"/>`,
		nowX, top+8, nowX, axisY+14, colPrimary)
	c.textBlock("NOW", nowX, top-10, 80, 12, 700, colPrimary, "middle", 1)
	c.textBlock("Past", left, axisY+14, 80, 13, 400, colMuted, "start", 1)
	c.textBlock("Future", right-60, axisY+14, 80, 13, 400, colMuted, "start", 1)

	zones := map[string][]VisualEvent{}
	for _, e := range events {
		when := e.When
		if when != "past" && when != "future" {
			when = "now"
		}
		zones[when] = append(zones[when], e)
	}
	bottom := axisY + 40
	place := func(list []VisualEvent, from, to float64) {
		if len(list) == 0 {
			return
		}
		step := (to - from) / float64(len(list)+1)
		width := math.Min(step*1.8, 170)
		for i, e := range list {
			ex := from + step*float64(i+1)
			fmt.Fprintf(&c.b, `<circle cx="%.1f" cy="%.1f" r="7" fill="%s" stroke="%s" stroke-width="3"/>`, ex, axisY, colPrimary, colCard)
			y := c.textBlock(e.Label, ex, axisY+26, width, 16, 700, colInk, "middle", 2)
			if strings.TrimSpace(e.Note) != "" {
				y = c.textBlock(e.Note, ex, y+2, width, 13, 400, colMuted, "middle", 3)
			}
			bottom = math.Max(bottom, y)
		}
	}
	place(zones["past"], left, nowX-30)
	if now := zones["now"]; len(now) > 0 {
		place(now[:1], nowX-80, nowX+80)
	}
	place(zones["future"], nowX+30, right)
	return bottom
}

// chips draws short tags in centred rows and returns the y below them.
func (c *canvas) chips(tags []string, top float64) float64 {
	const size, padX, h, gap = 14.0, 12.0, 30.0, 8.0
	type chip struct {
		text  string
		width float64
	}
	var rows [][]chip
	var row []chip
	rowW := 0.0
	maxW := visW - 2*visPad
	for _, t := range tags {
		w := textWidth(t, size, false) + 2*padX
		w = math.Min(w, maxW)
		if len(row) > 0 && rowW+gap+w > maxW {
			rows = append(rows, row)
			row, rowW = nil, 0
		}
		if len(row) > 0 {
			rowW += gap
		}
		row = append(row, chip{t, w})
		rowW += w
	}
	if len(row) > 0 {
		rows = append(rows, row)
	}
	y := top
	for _, r := range rows {
		total := 0.0
		for i, ch := range r {
			if i > 0 {
				total += gap
			}
			total += ch.width
		}
		x := (visW - total) / 2
		for _, ch := range r {
			fmt.Fprintf(&c.b, `<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="15" fill="%s" stroke="%s"/>`,
				x, y, ch.width, h, colChip, colBorder)
			fmt.Fprintf(&c.b, `<text x="%.1f" y="%.1f" font-size="%.0f" text-anchor="middle" fill="%s">%s</text>`,
				x+ch.width/2, y+h/2+size*0.35, size, colPrimary, esc(ellipsize(ch.text, ch.width-2*padX, size)))
			x += ch.width + gap
		}
		y += h + gap
	}
	return y - gap
}

// textBlock wraps text to width, draws it from y (the top of the first line) and returns the
// y below the last line. **bold** segments are drawn in the primary colour. Lines past
// maxLines are dropped and the last kept line ends in an ellipsis.
func (c *canvas) textBlock(text string, x, y, width, size float64, weight int, fill, anchor string, maxLines int) float64 {
	words := splitMarked(strings.TrimSpace(text))
	if len(words) == 0 {
		return y
	}
	lineH := size * 1.35
	lines := wrapWords(words, width, size, weight >= 600)
	if len(lines) > maxLines {
		lines = lines[:maxLines]
		last := lines[maxLines-1]
		last[len(last)-1].text = strings.TrimRight(last[len(last)-1].text, ".,;:") + "…"
	}
	for i, line := range lines {
		baseline := y + size + float64(i)*lineH
		fmt.Fprintf(&c.b, `<text x="%.1f" y="%.1f" font-size="%.0f" font-weight="%d" text-anchor="%s" fill="%s">`,
			x, baseline, size, weight, anchor, fill)
		for j, w := range line {
			sep := ""
			if j > 0 {
				sep = " "
			}
			if w.bold {
				fmt.Fprintf(&c.b, `<tspan font-weight="700" fill="%s">%s%s</tspan>`, colPrimary, esc(sep), esc(w.text))
			} else {
				fmt.Fprintf(&c.b, "%s%s", esc(sep), esc(w.text))
			}
		}
		c.b.WriteString("</text>")
	}
	return y + float64(len(lines))*lineH
}

type word struct {
	text string
	bold bool
}

// splitMarked turns "use **an** before vowels" into words, remembering which were marked.
func splitMarked(text string) []word {
	var out []word
	bold := false
	for i, part := range strings.Split(text, "**") {
		if i > 0 {
			bold = !bold
		}
		for _, w := range strings.Fields(part) {
			out = append(out, word{text: w, bold: bold})
		}
	}
	return out
}

func wrapWords(words []word, width, size float64, bold bool) [][]word {
	var lines [][]word
	var line []word
	lineW := 0.0
	space := textWidth(" ", size, bold)
	for _, w := range words {
		ww := textWidth(w.text, size, bold || w.bold)
		if ww > width { // a single word wider than the box is shortened, not overflowed
			w.text = ellipsize(w.text, width, size)
			ww = width
		}
		if len(line) > 0 && lineW+space+ww > width {
			lines = append(lines, line)
			line, lineW = nil, 0
		}
		if len(line) > 0 {
			lineW += space
		}
		line = append(line, w)
		lineW += ww
	}
	if len(line) > 0 {
		lines = append(lines, line)
	}
	return lines
}

// textWidth estimates rendered width. Proportional fonts average a little over half the font
// size per character; wide letters and capitals count for more, so this errs wide rather
// than letting text run past a box edge.
func textWidth(s string, size float64, bold bool) float64 {
	w := 0.0
	for _, r := range s {
		switch {
		case r == ' ':
			w += 0.28
		case strings.ContainsRune("iljtf.,;:'!|()[]", r):
			w += 0.32
		case strings.ContainsRune("mwMW", r):
			w += 0.86
		case r >= 'A' && r <= 'Z':
			w += 0.68
		default:
			w += 0.56
		}
	}
	if bold {
		w *= 1.07
	}
	return w * size
}

func ellipsize(s string, width, size float64) string {
	// A hair of tolerance: a box sized to a text's own width, minus its padding, comes back a
	// floating-point whisker narrower and turned "an" into "a…".
	if textWidth(s, size, false) <= width+0.5 {
		return s
	}
	runes := []rune(s)
	for len(runes) > 1 && textWidth(string(runes)+"…", size, false) > width {
		runes = runes[:len(runes)-1]
	}
	return string(runes) + "…"
}

func cleanStrings(in []string, limit int) []string {
	var out []string
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
		if len(out) == limit {
			break
		}
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func esc(s string) string { return html.EscapeString(s) }
