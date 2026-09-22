"use client";

import type { EmailChallenge } from "@engora/types";
import { useMutation } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";

/**
 * The two things a learner can do to their own account: take a copy of it, and close it.
 *
 * Closing is a three-step flow on purpose. A session proves somebody is at this keyboard;
 * it does not prove it is them, and deleting an account is the one action here that cannot
 * be undone by support, by us, or by paying again. So the API asks for a code sent to the
 * mailbox on the account, and the UI asks for the address to be typed out before it will
 * even send one.
 */

export const accountApi = {
  exportData: () => apiClient.get<Record<string, unknown>>("/account/export"),
  startDeletion: () => apiClient.post<EmailChallenge>("/account/deletion/start", {}),
  resendDeletion: () => apiClient.post<EmailChallenge>("/account/deletion/resend", {}),
  confirmDeletion: (input: { email: string; code: string }) => apiClient.post<void>("/account/deletion/confirm", input),
};

export function useExportAccount() {
  return useMutation({ mutationFn: accountApi.exportData });
}

export function useStartAccountDeletion() {
  return useMutation({ mutationFn: accountApi.startDeletion });
}

export function useResendAccountDeletion() {
  return useMutation({ mutationFn: accountApi.resendDeletion });
}

export function useConfirmAccountDeletion() {
  return useMutation({ mutationFn: accountApi.confirmDeletion });
}

/**
 * Hands the browser a file without a round trip to a download URL.
 *
 * The export arrives as an ordinary authenticated API response, so there is no link that
 * could be opened in a new tab — the file is built here from what we already have.
 */
export function saveAsJsonFile(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick: revoking immediately can cancel the download in some browsers.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
