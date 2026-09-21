import type { Notification, NotificationPreferences } from "@engora/types";

import { apiClient } from "@/lib/api";

export const notificationsApi = {
  /** The unread count comes back in the envelope's meta.total, so one request answers both
   *  "what is there" and "how many are new". */
  list: (unreadOnly = false) =>
    apiClient.getPage<Notification>("/notifications", { query: { unread: unreadOnly ? "true" : undefined } }),
  read: (id: string) => apiClient.post<void>(`/notifications/${id}/read`),
  readAll: () => apiClient.post<void>("/notifications/read-all"),
  preferences: () => apiClient.get<NotificationPreferences>("/notifications/preferences"),
  updatePreferences: (input: Partial<NotificationPreferences>) =>
    apiClient.put<NotificationPreferences>("/notifications/preferences", input),
};
