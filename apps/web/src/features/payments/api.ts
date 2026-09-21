import type { Checkout, PaymentMethods, PaymentTransaction } from "@engora/types";

import { apiClient } from "@/lib/api";

export const paymentsApi = {
  /** Whether checkout is available at all, so the billing page can say so rather than
   *  offering a button that fails. */
  methods: () => apiClient.get<PaymentMethods>("/payments/methods", { auth: false }),
  transactions: () => apiClient.get<PaymentTransaction[]>("/payments/transactions"),
  checkout: (planCode: string) => apiClient.post<Checkout>("/payments/checkout", { plan_code: planCode }),
};
