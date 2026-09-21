import { apiClient } from "@/lib/api";

/**
 * The platform's own public configuration: what the learner app needs in order to obey a
 * decision the owner made. Nothing private is in it — no internal flags, no routing — only
 * what a client legitimately needs to render itself.
 */
export interface PublicSettings {
  site_name: string;
  site_description: string;
  defaults: {
    interface_language: string;
    explanation_language: string;
    theme: string;
    landing_page: string;
    daily_goal_minutes: number;
    placement_test: boolean;
  };
  features: Record<string, boolean>;
  wallpapers: string[];
  maintenance: { enabled: boolean; message: string };
  updated_at: string;
}

export const platformApi = {
  // Unauthenticated: the sign-in screen needs the site name and the maintenance notice too.
  settings: () => apiClient.get<PublicSettings>("/settings", { auth: false }),
};
