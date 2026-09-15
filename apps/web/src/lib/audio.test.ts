import { describe, expect, it } from "vitest";

import { formatDuration, pickMimeType, rmsLevel } from "./audio";

describe("audio helpers", () => {
  it("formats durations as mm:ss", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(84_900)).toBe("01:24");
    expect(formatDuration(120_000)).toBe("02:00");
    expect(formatDuration(-5)).toBe("00:00");
  });

  it("computes loudness from analyser samples", () => {
    expect(rmsLevel(new Uint8Array(64).fill(128))).toBe(0);
    const loud = Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0));
    expect(rmsLevel(loud)).toBe(1);
    expect(rmsLevel([])).toBe(0);
  });

  it("picks the first supported recording format", () => {
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBeUndefined();
  });
});
