import { describe, expect, it } from "vitest";

import { en } from "./en";
import { ru } from "./ru";
import { uz } from "./uz";

/** Shape of a messages object: keys, array lengths and value kinds (string / function). */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (typeof value === "function") return "fn";
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, shape((value as Record<string, unknown>)[k])]));
  }
  return typeof value;
}

describe("landing locales", () => {
  it.each([
    ["uz", uz],
    ["ru", ru],
  ])("%s has exactly the same structure as en", (_, messages) => {
    expect(shape(messages)).toEqual(shape(en));
  });

  it("keeps product terms untranslated", () => {
    for (const messages of [uz, ru]) {
      expect(messages.skillNames).toEqual(en.skillNames);
      expect(messages.nav.ielts).toBe("IELTS");
    }
  });

  it("formats localized plan limits", () => {
    expect(en.pricing.limit(3, "AI speaking evaluations", "day")).toBe("3 AI speaking evaluations per day");
    expect(uz.pricing.limit(3, "AI speaking baholash", "day")).toBe("Kuniga 3 ta: AI speaking baholash");
    expect(ru.pricing.limit(3, "AI-оценки speaking", "day")).toBe("AI-оценки speaking: 3 в день");
  });
});
