"use client";

import { Check, Minus } from "lucide-react";
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioGroupPrimitive, Switch as SwitchPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const focusRing = "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";

function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer grid size-4.5 shrink-0 place-items-center rounded-sm border bg-surface shadow-xs transition-colors duration-micro",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-error",
        focusRing,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center">
        {props.checked === "indeterminate" ? <Minus className="size-3.5" /> : <Check className="size-3.5" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

function RadioGroup({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root data-slot="radio-group" className={cn("grid gap-3", className)} {...props} />;
}

function Radio({ className, ...props }: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio"
      className={cn(
        "grid size-4.5 shrink-0 place-items-center rounded-full border bg-surface shadow-xs transition-colors duration-micro",
        "data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:opacity-50",
        focusRing,
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
    </RadioGroupPrimitive.Item>
  );
}

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5.5 w-9.5 shrink-0 items-center rounded-full border border-transparent p-0.5 transition-colors duration-normal",
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-surface-active disabled:cursor-not-allowed disabled:opacity-50",
        focusRing,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4.5 rounded-full bg-surface shadow-sm transition-transform duration-normal ease-standard data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

/**
 * A large selectable option used for onboarding and preference pickers. Works as a radio
 * item (single choice) when rendered inside RadioGroup, or as a toggle button.
 */
function OptionCard({
  selected,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { selected: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected || undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-lg border bg-surface px-4 py-3.5 text-left text-body-sm font-medium shadow-xs",
        "transition-[background-color,border-color,box-shadow] duration-micro ease-standard hover:border-primary/40 hover:bg-surface-hover",
        "data-selected:border-primary data-selected:bg-primary-subtle data-selected:text-primary-subtle-foreground",
        focusRing,
        className,
      )}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className="ml-auto grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-micro group-data-selected:border-primary group-data-selected:bg-primary group-data-selected:text-primary-foreground"
      >
        <Check className="size-3 opacity-0 group-data-selected:opacity-100" strokeWidth={3} />
      </span>
    </button>
  );
}

export { Checkbox, OptionCard, Radio, RadioGroup, Switch };
