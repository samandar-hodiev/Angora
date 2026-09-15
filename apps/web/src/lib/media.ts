import { env } from "@/lib/env";

/** Turns an API asset path (e.g. /api/v1/avatars/...) into an absolute URL. */
export function apiAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return `${env.apiUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
