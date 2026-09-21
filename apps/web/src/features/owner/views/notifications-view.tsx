"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bell, Mail } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/choice";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { DataTable, Pagination, type Column } from "../components/data-table";
import { LiveDataState } from "../components/live-state";
import {
  FilterSelect,
  OwnerPageHeader,
  SavedTick,
  SectionCard,
  SegmentedControl,
} from "../components/primitives";
import {
  useNotificationTemplates,
  usePreviewNotificationTemplate,
  useSentNotifications,
  useUpdateNotificationTemplate,
} from "../hooks";
import { formatDateTime, formatNumber } from "../lib/format";
import { contentLanguageLabels, contentLanguages } from "../types";
import type { ContentLanguage, NotificationTemplateRow, SentNotificationRow } from "../types";

/**
 * The words the platform says to learners.
 *
 * Copy that reaches an inbox is product work, so it lives in a table rather than in a Go
 * string literal: fixing a clumsy sentence should not need a deploy, and translating one
 * should not need a developer. Each template exists once per language, and a learner is sent
 * the one that matches the language they told us they speak, falling back to English.
 *
 * Two guard rails are visible here on purpose. A template whose text uses a placeholder it
 * has not declared is flagged, because that placeholder will reach a learner verbatim. And
 * a template cannot have both channels switched off — that reads like "disabled" but is
 * actually a template nobody will ever receive, which is what `Active` is for.
 */

export function OwnerNotificationsView() {
  const templates = useNotificationTemplates();
  const [locale, setLocale] = useState<ContentLanguage>("en");
  const [selected, setSelected] = useState<string | null>(null);

  const codes = useMemo(() => {
    const seen = new Map<string, NotificationTemplateRow>();
    for (const t of templates.data ?? []) {
      if (!seen.has(t.code)) seen.set(t.code, t);
    }
    return [...seen.values()];
  }, [templates.data]);

  const activeCode = selected ?? codes[0]?.code ?? null;
  const template = (templates.data ?? []).find((t) => t.code === activeCode && t.locale === locale) ?? null;

  return (
    <>
      <OwnerPageHeader
        title="Notifications"
        description="What the platform says to learners, in their own language."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Notifications" }]}
      />

      {templates.isError ? (
        <LiveDataState error={templates.error} onRetry={() => void templates.refetch()} />
      ) : templates.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <SectionCard title="Templates" description={`${codes.length} messages`} bodyClassName="p-2">
            <ul className="grid gap-1">
              {codes.map((row) => {
                const translations = (templates.data ?? []).filter((t) => t.code === row.code);
                const flagged = translations.some((t) => (t.missing_variables ?? []).length > 0);
                return (
                  <li key={row.code}>
                    <button
                      type="button"
                      onClick={() => setSelected(row.code)}
                      aria-current={row.code === activeCode}
                      className={
                        "grid w-full gap-0.5 rounded-lg px-3 py-2 text-left transition-colors duration-micro " +
                        (row.code === activeCode ? "bg-surface-active" : "hover:bg-surface-hover")
                      }
                    >
                      <span className="flex items-center gap-1.5 truncate text-body-sm">
                        {row.name}
                        {flagged && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label="Unknown placeholder" />}
                      </span>
                      <span className="truncate font-mono text-caption text-fg-muted">{row.code}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <div className="grid gap-4">
            <SegmentedControl
              value={locale}
              onChange={(value) => setLocale(value as ContentLanguage)}
              options={contentLanguages.map((code) => ({
                value: code,
                label: contentLanguageLabels[code],
              }))}
              label="Language"
            />
            {template ? (
              <TemplateEditor key={`${template.code}-${template.locale}`} template={template} />
            ) : (
              <SectionCard title="Not translated" description={contentLanguageLabels[locale]}>
                <p className="py-8 text-center text-body-sm text-fg-muted">
                  This message has no {contentLanguageLabels[locale]} version. Learners who chose that language
                  are sent the English one.
                </p>
              </SectionCard>
            )}
          </div>
        </div>
      )}

      <div className="mt-6">
        <DeliveryLog codes={codes.map((c) => c.code)} />
      </div>
    </>
  );
}

function TemplateEditor({ template }: { template: NotificationTemplateRow }) {
  const save = useUpdateNotificationTemplate();
  const preview = usePreviewNotificationTemplate();

  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [inApp, setInApp] = useState(template.in_app);
  const [email, setEmail] = useState(template.email);
  const [active, setActive] = useState(template.is_active);

  const dirty =
    subject !== template.subject ||
    body !== template.body ||
    inApp !== template.in_app ||
    email !== template.email ||
    active !== template.is_active;

  // Preview follows what is on screen, including unsaved text: the point of a preview is to
  // see the change before a learner does.
  useEffect(() => {
    const timer = setTimeout(() => {
      preview.mutate({ code: template.code, locale: template.locale, input: { subject, body } });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, body, template.code, template.locale]);

  const missing = preview.data?.missing_variables ?? [];

  return (
    <SectionCard
      title={template.name}
      description={template.description}
      action={
        <>
          <SavedTick saved={save.isSuccess && !dirty} />
          <Button
            size="sm"
            disabled={!dirty || save.isPending || (!inApp && !email)}
            onClick={() =>
              save.mutate({
                code: template.code,
                locale: template.locale,
                input: { subject, body, in_app: inApp, email, is_active: active },
              })
            }
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="template-subject">Subject</Label>
          <Input id="template-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="template-body">Message</Label>
          <Textarea id="template-body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} />
          <p className="text-caption text-fg-muted">
            Placeholders available:{" "}
            {template.variables.length > 0 ? (
              template.variables.map((v) => (
                <code key={v} className="mr-1 rounded bg-surface-active px-1 font-mono">{`{{${v}}}`}</code>
              ))
            ) : (
              <span>none</span>
            )}
          </p>
        </div>

        {missing.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-subtle/40 p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <p className="text-caption">
              {missing.map((v) => `{{${v}}}`).join(", ")} {missing.length === 1 ? "is" : "are"} not filled by anything.
              Learners will read {missing.length === 1 ? "it" : "them"} exactly as written.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <ChannelToggle
            icon={Bell}
            label="In-app"
            checked={inApp}
            onChange={setInApp}
            hint="Shown in the learner's notification list"
          />
          <ChannelToggle
            icon={Mail}
            label="Email"
            checked={email}
            onChange={setEmail}
            hint="Sent to their address"
          />
          <div className="grid gap-1 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`active-${template.code}`}>Active</Label>
              <Switch id={`active-${template.code}`} checked={active} onCheckedChange={setActive} />
            </div>
            <p className="text-caption text-fg-muted">Off stops this message entirely</p>
          </div>
        </div>

        {!inApp && !email && (
          <p className="text-caption text-error">
            A template needs at least one channel. To stop sending it, switch Active off instead.
          </p>
        )}

        <div className="rounded-lg border bg-surface-subtle p-4">
          <p className="mb-2 text-label text-fg-muted">Preview</p>
          {preview.isPending && !preview.data ? (
            <Skeleton className="h-16" />
          ) : (
            <div className="grid gap-1">
              <p className="text-body-sm font-medium">{preview.data?.subject ?? subject}</p>
              <p className="whitespace-pre-wrap text-body-sm text-fg-secondary">{preview.data?.body ?? body}</p>
            </div>
          )}
        </div>

        <p className="text-caption text-fg-muted">
          Sent {formatNumber(template.sent_30d)} times in the last 30 days · updated {formatDateTime(template.updated_at)}
        </p>
      </div>
    </SectionCard>
  );
}

function ChannelToggle({
  icon: Icon,
  label,
  checked,
  onChange,
  hint,
}: {
  icon: typeof Bell;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint: string;
}) {
  const id = `channel-${label.toLowerCase()}`;
  return (
    <div className="grid gap-1 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="flex items-center gap-1.5">
          <Icon className="size-3.5 text-fg-muted" aria-hidden />
          {label}
        </Label>
        <Switch id={id} checked={checked} onCheckedChange={onChange} />
      </div>
      <p className="text-caption text-fg-muted">{hint}</p>
    </div>
  );
}

/** Did it go out, and did anybody read it — the only two questions anyone asks. */
function DeliveryLog({ codes }: { codes: string[] }) {
  const [code, setCode] = useState("all");
  const [page, setPage] = useState(1);
  const sent = useSentNotifications({ code: code === "all" ? undefined : code, page });

  const columns: Column<SentNotificationRow>[] = [
    {
      key: "when",
      header: "When",
      cell: (row) => <span className="text-fg-muted tabular-nums">{formatDateTime(row.created_at)}</span>,
    },
    { key: "learner", header: "Learner", cell: (row) => <span className="truncate">{row.learner_email}</span> },
    {
      key: "template",
      header: "Message",
      cell: (row) => (
        <span className="grid gap-0.5">
          <span className="truncate">{row.title}</span>
          <code className="truncate font-mono text-caption text-fg-muted">{row.template_code ?? "—"}</code>
        </span>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      cell: (row) => <Badge variant="outline">{row.channel === "in_app" ? "in-app" : row.channel}</Badge>,
    },
    {
      key: "delivery",
      header: "Delivered",
      hideBelow: "md",
      cell: (row) =>
        row.sent_at ? (
          <span className="text-caption text-success">{formatDateTime(row.sent_at)}</span>
        ) : (
          // An email row with no sent_at is one the mail provider refused. It is written
          // before the send precisely so that failure is visible rather than silent.
          <span className="text-caption text-error">Not delivered</span>
        ),
    },
    {
      key: "read",
      header: "Read",
      hideBelow: "lg",
      cell: (row) =>
        row.read_at ? (
          <span className="text-caption text-fg-secondary">{formatDateTime(row.read_at)}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        ),
    },
  ];

  return (
    <SectionCard
      title="Delivery log"
      description="Every message that left the building"
      bodyClassName="p-0"
      action={
        <FilterSelect
          label="Message"
          value={code}
          options={[{ value: "all", label: "All messages" }, ...codes.map((c) => ({ value: c, label: c }))]}
          onChange={(value) => {
            setCode(value);
            setPage(1);
          }}
        />
      }
    >
      {sent.isError ? (
        <div className="p-4">
          <LiveDataState error={sent.error} onRetry={() => void sent.refetch()} />
        </div>
      ) : sent.isPending ? (
        <div className="grid gap-2 p-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          <DataTable
            caption="Notifications sent"
            columns={columns}
            rows={sent.data?.items ?? []}
            rowKey={(row) => row.id}
            minWidth="62rem"
            empty={<p className="py-8 text-center text-body-sm text-fg-muted">Nothing has been sent yet.</p>}
          />
          <Pagination
            page={sent.data?.page ?? 1}
            totalPages={sent.data?.total_pages ?? 1}
            total={sent.data?.total ?? 0}
            pageSize={25}
            onPageChange={setPage}
            label="notifications"
          />
        </>
      )}
    </SectionCard>
  );
}
