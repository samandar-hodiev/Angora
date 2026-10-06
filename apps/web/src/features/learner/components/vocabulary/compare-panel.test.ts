import { describe, expect, it } from "vitest";

import { splitByTerms } from "./compare-panel";

describe("splitByTerms", () => {
  it("uses a note per word when the comparison has them", () => {
    const r = splitByTerms("Overview.", ["ask", "request"], ["oddiy savol", "muloyim so'rov"]);
    expect(r).toEqual({
      overview: "Overview.",
      notes: [
        { term: "ask", note: "oddiy savol" },
        { term: "request", note: "muloyim so'rov" },
      ],
    });
  });

  it("cuts an older paragraph where each word begins", () => {
    const r = splitByTerms(
      "Ask - oddiy savol berish uchun. Inquire - rasmiy va muloyim so'rash. Request - kerak bo'lgan narsani so'rash.",
      ["ask", "inquire", "request"],
      [undefined, undefined, undefined],
    );
    expect(r.overview).toBe("");
    expect(r.notes.map((n) => n.term)).toEqual(["ask", "inquire", "request"]);
    expect(r.notes[1]!.note).toBe("rasmiy va muloyim so'rash.");
  });

  it("keeps a paragraph whole when the words cannot be found at sentence starts", () => {
    const r = splitByTerms(
      '"Love" juda kuchli his-tuyg\'u, affection esa yumshoqroq.',
      ["love", "affection"],
      [undefined, undefined],
    );
    expect(r.notes).toEqual([]);
  });
});
