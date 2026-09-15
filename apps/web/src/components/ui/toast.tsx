"use client";

import { CircleAlert, CircleCheck, Info, XIcon } from "lucide-react";
import { Toast as ToastPrimitive } from "radix-ui";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

type ToastVariant = "default" | "success" | "error";

interface ToastItem {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Show a short, non-blocking notification. Accessible via a polite live region. */
export function toast(input: { title: string; description?: string; variant?: ToastVariant }) {
  const item: ToastItem = { id: nextId++, title: input.title, description: input.description, variant: input.variant ?? "default" };
  items = [...items, item].slice(-3);
  emit();
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => items;
const emptySnapshot = (): ToastItem[] => [];

const icons = { default: Info, success: CircleCheck, error: CircleAlert };

export function Toaster() {
  const toasts = useSyncExternalStore(subscribe, snapshot, emptySnapshot);

  return (
    <ToastPrimitive.Provider swipeDirection="right" duration={4500}>
      {toasts.map((t) => {
        const Icon = icons[t.variant];
        return (
          <ToastPrimitive.Root
            key={t.id}
            onOpenChange={(open) => !open && dismiss(t.id)}
            className={cn(
              "glass pointer-events-auto flex w-full items-start gap-3 rounded-lg p-4 text-foreground",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[swipe=end]:animate-out",
            )}
          >
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-4 shrink-0",
                t.variant === "success" && "text-success",
                t.variant === "error" && "text-error",
                t.variant === "default" && "text-primary",
              )}
            />
            <div className="grid flex-1 gap-0.5">
              <ToastPrimitive.Title className="text-label">{t.title}</ToastPrimitive.Title>
              {t.description && (
                <ToastPrimitive.Description className="text-body-sm text-fg-secondary">{t.description}</ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close aria-label="Dismiss" className="rounded-md p-0.5 text-fg-muted hover:text-foreground">
              <XIcon className="size-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        );
      })}
      <ToastPrimitive.Viewport className="fixed right-0 bottom-20 z-[60] flex w-full max-w-sm flex-col gap-2 p-4 outline-none md:bottom-0" />
    </ToastPrimitive.Provider>
  );
}
