"use client";

import { Check, Eye, Lock, Pencil, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { DataTable, type Column } from "../components/data-table";
import {
  FilterBar,
  FilterSelect,
  OwnerPageHeader,
  SearchInput,
  SectionCard,
  SegmentedControl,
} from "../components/primitives";
import { useFeatureAccess, useUpdateFeatureAccess } from "../hooks";
import { formatNumber, planLabels, skillLabels } from "../lib/format";
import type { FeatureAccess, FeatureStatus, PlanCode, SkillKey } from "../types";
import { planCodes } from "../types";

const statusLabels: Record<FeatureStatus, string> = {
  free: "Free",
  premium: "Premium only",
  limited: "Limited",
  disabled: "Disabled",
};

const statusStyles: Record<FeatureStatus, string> = {
  free: "border-transparent bg-success/15 text-success",
  premium: "border-transparent bg-primary-subtle text-primary-subtle-foreground",
  limited: "border-transparent bg-warning/20 text-warning-foreground",
  disabled: "border-transparent bg-surface-active text-fg-muted",
};

const statusOptions = [
  { value: "all" as const, label: "All statuses" },
  ...(Object.keys(statusLabels) as FeatureStatus[]).map((status) => ({ value: status, label: statusLabels[status] })),
];

const categoryOptions = [
  { value: "all" as const, label: "All categories" },
  ...(Object.keys(skillLabels) as SkillKey[]).map((skill) => ({ value: skill, label: skillLabels[skill] })),
  { value: "platform" as const, label: "Platform" },
];

const planOptions = planCodes.map((plan) => ({ value: plan, label: planLabels[plan] }));

function limitFor(feature: FeatureAccess, plan: PlanCode): number | null {
  if (plan === "free") return feature.free_limit;
  if (plan === "premium") return feature.premium_limit;
  return feature.unlimited_limit;
}

function accessLabel(feature: FeatureAccess, plan: PlanCode): { label: string; tone: "yes" | "no" | "limited" } {
  if (feature.status === "disabled") return { label: "Disabled", tone: "no" };
  const limit = limitFor(feature, plan);
  if (limit === 0) return { label: "Locked", tone: "no" };
  if (limit === null) return { label: "Unlimited", tone: "yes" };
  return { label: `${formatNumber(limit)} / ${feature.period}`, tone: "limited" };
}

export function PaywallView() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<FeatureStatus | "all">("all");
  const [category, setCategory] = useState<SkillKey | "platform" | "all">("all");
  const [previewPlan, setPreviewPlan] = useState<PlanCode>("free");
  const [editing, setEditing] = useState<FeatureAccess | null>(null);
  const [previewing, setPreviewing] = useState<FeatureAccess | null>(null);

  const features = useFeatureAccess();

  const rows = useMemo(() => {
    let items = features.data ?? [];
    if (search) {
      const needle = search.toLowerCase();
      items = items.filter(
        (feature) => feature.name.toLowerCase().includes(needle) || feature.key.toLowerCase().includes(needle),
      );
    }
    if (status !== "all") items = items.filter((feature) => feature.status === status);
    if (category !== "all") items = items.filter((feature) => feature.category === category);
    return items;
  }, [features.data, search, status, category]);

  const columns: Column<FeatureAccess>[] = [
    {
      key: "feature",
      header: "Feature",
      width: "22rem",
      cell: (feature) => (
        <div className="grid min-w-0 gap-0.5">
          <span className="font-medium">{feature.name}</span>
          <span className="truncate text-caption text-fg-muted">{feature.description}</span>
          <code className="truncate font-mono text-caption text-fg-disabled">{feature.key}</code>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      hideBelow: "lg",
      cell: (feature) => (
        <span className="text-fg-secondary">
          {feature.category === "platform" ? "Platform" : skillLabels[feature.category]}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (feature) => <Badge className={statusStyles[feature.status]}>{statusLabels[feature.status]}</Badge>,
    },
    ...planCodes.map<Column<FeatureAccess>>((plan) => ({
      key: plan,
      header: planLabels[plan],
      hideBelow: plan === "free" ? undefined : "md",
      cell: (feature) => {
        const access = accessLabel(feature, plan);
        return (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-body-sm",
              access.tone === "yes" && "text-success",
              access.tone === "no" && "text-fg-muted",
              plan === previewPlan && "font-medium",
            )}
          >
            {access.tone === "yes" ? (
              <Check className="size-3.5" aria-hidden />
            ) : access.tone === "no" ? (
              <X className="size-3.5" aria-hidden />
            ) : (
              <Sparkles className="size-3.5 text-warning" aria-hidden />
            )}
            {access.label}
          </span>
        );
      },
    })),
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (feature) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setPreviewing(feature)}>
            <Eye aria-hidden />
            <span className="sr-only sm:not-sr-only">Preview</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEditing(feature)}>
            <Pencil aria-hidden />
            <span className="sr-only sm:not-sr-only">Edit</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <OwnerPageHeader
        title="Feature access"
        description="Control which learner features are free, premium-only, limited, or disabled."
        breadcrumbs={[{ label: "Owner", href: "/owner/dashboard" }, { label: "Paywall" }]}
      />

      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <SectionCard title="How this works" description="One configuration, enforced everywhere">
          <p className="text-body-sm text-fg-secondary">
            Nothing in the learner app checks a plan name. Each feature has a key, and the app asks whether the learner
            holds that key — so changing a row here changes every button, panel and prompt that depends on it, without
            touching the learner UI.
          </p>
          <p className="mt-2 text-caption text-fg-muted">
            The API enforces the same configuration server-side. Hiding a button is never the protection.
          </p>
        </SectionCard>

        <SectionCard title="Preview as learner" description="See what each plan reaches">
          <SegmentedControl label="Preview plan" value={previewPlan} options={planOptions} onChange={setPreviewPlan} />
          <p className="mt-3 text-caption text-fg-muted">
            The <strong className="font-medium text-foreground">{planLabels[previewPlan]}</strong> column is highlighted
            below. Open any feature&apos;s preview to see exactly what that learner is shown.
          </p>
        </SectionCard>
      </div>

      <FilterBar
        onReset={() => {
          setSearch("");
          setStatus("all");
          setCategory("all");
        }}
        resultLabel={features.isPending ? undefined : `${rows.length} features`}
      >
        <SearchInput value={search} onChange={setSearch} label="Search features" placeholder="Search features" />
        <FilterSelect label="Status" value={status} options={statusOptions} onChange={setStatus} />
        <FilterSelect label="Category" value={category} options={categoryOptions} onChange={setCategory} />
      </FilterBar>

      <SectionCard title="Features" description="Access per plan" bodyClassName="p-0">
        <DataTable
          caption="Feature access per plan"
          columns={columns}
          rows={rows}
          rowKey={(feature) => feature.key}
          isLoading={features.isPending}
          isError={features.isError}
          error={features.error}
          onRetry={() => void features.refetch()}
          minWidth="60rem"
          empty={<EmptyState title="No features match these filters" description="Clear the filters to see all of them." />}
        />
      </SectionCard>

      <EditFeatureDialog feature={editing} onClose={() => setEditing(null)} />
      <PaywallPreviewDialog feature={previewing} plan={previewPlan} onClose={() => setPreviewing(null)} />
    </>
  );
}

function EditFeatureDialog({ feature, onClose }: { feature: FeatureAccess | null; onClose: () => void }) {
  const update = useUpdateFeatureAccess();
  const [status, setStatus] = useState<FeatureStatus>("free");
  const [limits, setLimits] = useState({ free: "0", premium: "0", unlimited: "unlimited" });
  const [loaded, setLoaded] = useState<string | null>(null);

  // Load the row's values the first time this dialog sees it.
  if (feature && loaded !== feature.key) {
    setLoaded(feature.key);
    setStatus(feature.status);
    setLimits({
      free: feature.free_limit === null ? "unlimited" : String(feature.free_limit),
      premium: feature.premium_limit === null ? "unlimited" : String(feature.premium_limit),
      unlimited: feature.unlimited_limit === null ? "unlimited" : String(feature.unlimited_limit),
    });
  }

  function parseLimit(value: string): number | null {
    if (value.trim() === "" || value === "unlimited") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
  }

  function save() {
    if (!feature) return;
    update.mutate(
      {
        key: feature.key,
        patch: {
          status,
          free_limit: status === "disabled" ? 0 : parseLimit(limits.free),
          premium_limit: status === "disabled" ? 0 : parseLimit(limits.premium),
          unlimited_limit: status === "disabled" ? 0 : parseLimit(limits.unlimited),
        },
      },
      {
        onSuccess: () => {
          toast({ title: `${feature.name} updated`, description: "Learners see the change immediately.", variant: "success" });
          onClose();
        },
        onError: () => toast({ title: "That change did not go through", variant: "error" }),
      },
    );
  }

  return (
    <Dialog open={feature !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{feature?.name}</DialogTitle>
          <DialogDescription>{feature?.description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="feature-status">Access status</Label>
            <NativeSelect id="feature-status" value={status} onChange={(event) => setStatus(event.target.value as FeatureStatus)}>
              <option value="free">Free — every learner</option>
              <option value="premium">Premium only</option>
              <option value="limited">Limited — quota per plan</option>
              <option value="disabled">Disabled — nobody</option>
            </NativeSelect>
          </div>

          <fieldset className="grid gap-3" disabled={status === "disabled"}>
            <legend className="text-label text-fg-muted">
              Monthly quota per plan — leave empty or type &ldquo;unlimited&rdquo; for no limit, 0 to lock
            </legend>
            {planCodes.map((plan) => (
              <div key={plan} className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3">
                <Label htmlFor={`limit-${plan}`}>{planLabels[plan]}</Label>
                <Input
                  id={`limit-${plan}`}
                  value={limits[plan]}
                  inputMode="numeric"
                  onChange={(event) => setLimits((current) => ({ ...current, [plan]: event.target.value }))}
                />
              </div>
            ))}
          </fieldset>

          <p className="text-caption text-fg-muted">
            Saved to the mock configuration. The real endpoint is PATCH /api/v1/owner/paywall/{feature?.key ?? ""}.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={save}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Exactly what a learner on the selected plan is shown when they reach for this feature. */
function PaywallPreviewDialog({
  feature,
  plan,
  onClose,
}: {
  feature: FeatureAccess | null;
  plan: PlanCode;
  onClose: () => void;
}) {
  if (!feature) return null;
  const access = accessLabel(feature, plan);
  const locked = access.tone === "no";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{feature.name}</DialogTitle>
          <DialogDescription>
            Previewing as a <strong>{planLabels[plan]}</strong> learner.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border bg-surface p-6 text-center">
          {locked ? (
            <>
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
                <Lock className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-h4">Premium feature</p>
              <p className="mt-1 text-body-sm text-fg-secondary">
                {feature.status === "disabled"
                  ? "This feature is switched off for everyone right now."
                  : `${feature.name} is available for Premium members.`}
              </p>
              {feature.status !== "disabled" && (
                <Button className="mt-4" disabled>
                  Upgrade to Premium
                </Button>
              )}
            </>
          ) : (
            <>
              <span className="mx-auto grid size-12 place-items-center rounded-full bg-success/15 text-success">
                <Check className="size-5" aria-hidden />
              </span>
              <p className="mt-3 text-h4">Available</p>
              <p className="mt-1 text-body-sm text-fg-secondary">
                {access.label === "Unlimited"
                  ? `${planLabels[plan]} learners can use ${feature.name} without a limit.`
                  : `${planLabels[plan]} learners get ${access.label}.`}
              </p>
            </>
          )}
        </div>

        <p className="text-caption text-fg-muted">
          Frontend simulation for QA. The learner app reads the same configuration through the entitlements API.
        </p>

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
