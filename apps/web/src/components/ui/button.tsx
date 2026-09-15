import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot as SlotPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium select-none",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-micro ease-standard",
    "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-error",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-active",
        secondary: "bg-surface-active text-foreground hover:bg-surface-active/80",
        outline: "border bg-surface text-foreground shadow-xs hover:bg-surface-hover",
        ghost: "text-fg-secondary hover:bg-surface-hover hover:text-foreground",
        subtle: "bg-primary-subtle text-primary-subtle-foreground hover:bg-primary-subtle/70",
        /** Primary call to action with the liquid-glass treatment. */
        liquid: "btn-liquid font-semibold text-primary-foreground",
        /** Secondary action on glass surfaces. */
        glass: "glass-button text-foreground",
        destructive: "bg-error text-error-foreground shadow-xs hover:bg-error/90",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline active:translate-y-0",
      },
      size: {
        sm: "h-8 gap-1.5 px-3 has-[>svg]:px-2.5",
        default: "h-10 px-4 has-[>svg]:px-3",
        lg: "h-11 px-6 text-body has-[>svg]:px-5",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Shows a spinner, disables the button and announces busy state. */
    loading?: boolean;
  };

function Button({ className, variant, size, asChild = false, loading = false, children, disabled, ...props }: ButtonProps) {
  if (asChild) {
    return (
      <SlotPrimitive.Slot data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props}>
        {children}
      </SlotPrimitive.Slot>
    );
  }
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/** Icon-only button. `label` is required so screen readers can announce it. */
function IconButton({
  label,
  className,
  variant = "ghost",
  size = "icon",
  children,
  ...props
}: Omit<ButtonProps, "asChild"> & { label: string }) {
  return (
    <Button variant={variant} size={size} aria-label={label} title={label} className={className} {...props}>
      {children}
    </Button>
  );
}

export { Button, buttonVariants, IconButton };
