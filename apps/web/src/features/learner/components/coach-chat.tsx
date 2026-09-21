"use client";

import { MessageCircle, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCoachConversations, useSendCoachMessage } from "@/features/practice/hooks";
import { isApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The coach conversation.
 *
 * One thread at a time: a learner asking about the past simple does not want a folder of
 * chats, they want to keep asking. The most recent thread continues automatically and
 * "Start a new topic" is there when the subject changes.
 */
export function CoachChat() {
  const conversations = useCoachConversations();
  const send = useSendCoachMessage();
  const [draft, setDraft] = useState("");
  const [threadID, setThreadID] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement>(null);

  const current = send.data ?? undefined;
  const messages = current?.messages ?? [];

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  function submit() {
    const message = draft.trim();
    if (message.length < 2) return;
    send.mutate(
      { conversation_id: threadID ?? current?.id, message },
      { onSuccess: (conversation) => setThreadID(conversation.id) },
    );
    setDraft("");
  }

  return (
    <div className="grid gap-4 rounded-xl border bg-surface p-5">
      <div className="grid max-h-96 min-h-40 gap-3 overflow-y-auto rounded-lg bg-surface-hover p-4">
        {messages.length === 0 ? (
          <div className="grid place-items-center py-6 text-center">
            <div className="grid justify-items-center gap-2">
              <MessageCircle className="size-5 text-fg-muted" aria-hidden />
              <p className="text-body-sm text-fg-secondary">
                Ask about a rule, a mistake you keep making, or what to practise next.
              </p>
              {conversations.data && conversations.data.length > 0 && (
                <p className="text-caption text-fg-muted">
                  You have {conversations.data.length} earlier {conversations.data.length === 1 ? "thread" : "threads"}.
                </p>
              )}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[85%] rounded-lg px-3.5 py-2.5 text-body-sm",
                message.role === "user"
                  ? "justify-self-end bg-primary-subtle text-primary-subtle-foreground"
                  : "justify-self-start border bg-surface",
              )}
            >
              {message.content}
            </div>
          ))
        )}
        {send.isPending && <Skeleton className="h-10 w-2/3 justify-self-start" />}
        <div ref={endRef} />
      </div>

      {send.isError && (
        <p role="alert" className="text-body-sm text-error">
          {isApiError(send.error) ? send.error.message : "Your message could not be sent."}
        </p>
      )}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about grammar, vocabulary or your plan…"
          aria-label="Message your coach"
        />
        <Button type="submit" loading={send.isPending} disabled={draft.trim().length < 2}>
          <Send aria-hidden /> Send
        </Button>
      </form>

      {messages.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-fit"
          onClick={() => {
            setThreadID(undefined);
            send.reset();
          }}
        >
          Start a new topic
        </Button>
      )}
    </div>
  );
}
