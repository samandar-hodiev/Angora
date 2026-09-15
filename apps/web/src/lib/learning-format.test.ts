import { describe, expect, it } from "vitest";

import { formatCategory, formatGroup, timeAgo } from "./learning-format";

describe("learning format", () => {
  it("humanises mistake categories from the API taxonomy", () => {
    expect(formatCategory("grammar.tense.present_perfect")).toBe("Present perfect");
    expect(formatCategory("vocabulary.collocation")).toBe("Collocation");
    expect(formatGroup("pronunciation.th_sound")).toBe("Pronunciation");
  });

  it("formats relative times", () => {
    const now = Date.parse("2026-09-14T12:00:00Z");
    expect(timeAgo("2026-09-14T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-09-14T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-09-12T12:00:00Z", now)).toBe("2d ago");
  });
});
