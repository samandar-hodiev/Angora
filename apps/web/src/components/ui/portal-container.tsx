"use client";

import { createContext, useContext } from "react";

/**
 * Where dialogs, menus and tooltips render.
 *
 * By default they portal to <body>, which carries the learner app's theme. A subtree with a
 * theme of its own — the Owner Console in its light theme — provides an element inside that
 * subtree here, so what opens over it is drawn in the same theme instead of the learner's.
 * Undefined means <body>, which is right everywhere else.
 */
export const PortalContainerContext = createContext<HTMLElement | null>(null);

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext) ?? undefined;
}
