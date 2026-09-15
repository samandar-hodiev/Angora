import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-24 w-full rounded-md border bg-surface px-3 py-2.5 text-body shadow-xs outline-none md:text-body-sm",
        "placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50",
        "transition-[border-color,box-shadow] duration-micro focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "aria-invalid:border-error aria-invalid:ring-error/20",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
