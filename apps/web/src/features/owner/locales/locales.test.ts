import { describe, expect, it } from "vitest";

import { ownerEn } from "./en";
import { ownerRu } from "./ru";
import { ownerUz } from "./uz";

/** Keys and value kinds, so a missing or mistyped translation fails here, not in front of an operator. */
function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (typeof value === "function") return "fn";
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, shape((value as Record<string, unknown>)[k])]));
  }
  return typeof value;
}

describe("owner console locales", () => {
  it.each([
    ["uz", ownerUz],
    ["ru", ownerRu],
  ])("%s has exactly the same structure as en", (_, messages) => {
    expect(shape(messages)).toEqual(shape(ownerEn));
  });

  it("leaves product terms alone", () => {
    for (const messages of [ownerUz, ownerRu]) {
      expect(messages.nav.ai).toBe("AI");
      expect(messages.nav.contentCms).toBe("Content CMS");
      expect(messages.nav.paywall).toBe("Paywall");
    }
  });

  it("actually translates the things an operator reads first", () => {
    // A dictionary that silently falls back to English everywhere is not a translation.
    expect(ownerUz.nav.learners).not.toBe(ownerEn.nav.learners);
    expect(ownerRu.nav.learners).not.toBe(ownerEn.nav.learners);
    expect(ownerUz.shell.ownerSettings).not.toBe(ownerEn.shell.ownerSettings);
  });
});
