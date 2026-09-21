"use client";

import { Bell } from "lucide-react";

import { IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from "../hooks";

/**
 * The bell.
 *
 * Opening the list does not mark anything read: a learner who glances at the bell and
 * closes it has not read their messages, and quietly clearing the badge for them loses the
 * one thing the badge is for. Reading one, or pressing "Mark all read", does.
 */
export function NotificationsMenu() {
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const items = notifications.data?.items ?? [];
  const unread = notifications.data?.meta.total ?? 0;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
          <Bell />
          {unread > 0 && (
            <span
              aria-hidden
              className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[0.625rem] font-medium leading-4 text-primary-foreground tabular-nums"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <button
              type="button"
              className="text-caption text-fg-muted transition-colors duration-micro hover:text-foreground"
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          )}
        </div>

        {notifications.isPending ? (
          <div className="grid gap-2 p-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid justify-items-center gap-1 px-4 py-6 text-center">
            <Bell className="size-5 text-fg-muted" aria-hidden />
            <p className="text-label">You&apos;re all caught up</p>
            <p className="text-caption text-fg-muted">Feedback results and reminders will appear here.</p>
          </div>
        ) : (
          <ul className="max-h-96 overflow-y-auto border-t">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => !item.read_at && markRead.mutate(item.id)}
                  className={cn(
                    "grid w-full gap-0.5 border-b px-3 py-2.5 text-left transition-colors duration-micro last:border-b-0 hover:bg-surface-hover",
                    !item.read_at && "bg-primary-subtle/30",
                  )}
                >
                  <span className="flex items-start gap-2">
                    {!item.read_at && <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />}
                    <span className="text-body-sm font-medium">{item.title}</span>
                  </span>
                  {item.body && <span className="text-caption text-fg-secondary">{item.body}</span>}
                  <span className="text-caption text-fg-muted">
                    {new Date(item.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
