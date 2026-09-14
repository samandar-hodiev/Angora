import type { CurrentSubscription, SubscriptionPlan } from "@engora/types";

import { apiClient } from "@/lib/api";

export const subscriptionApi = {
  plans: () => apiClient.get<SubscriptionPlan[]>("/subscriptions/plans", { auth: false }),
  current: () => apiClient.get<CurrentSubscription>("/subscriptions/me"),
};
