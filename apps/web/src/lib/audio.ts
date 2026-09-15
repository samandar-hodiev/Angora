/** mm:ss for durations in milliseconds. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Root-mean-square loudness (0–1) of a time-domain sample buffer from an AnalyserNode
 * (unsigned bytes centred on 128). A small gain makes normal speech visible.
 */
export function rmsLevel(samples: ArrayLike<number>, gain = 3.5): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = ((samples[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * gain);
}

/** Recording formats in order of preference; the API accepts all of them. */
export const RECORDING_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"] as const;

export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return RECORDING_MIME_TYPES.find((type) => isSupported(type));
}
