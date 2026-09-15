import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-md border bg-surface px-3 py-2 text-body shadow-xs outline-none md:text-body-sm",
        "placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-body-sm file:font-medium",
        "transition-[border-color,box-shadow] duration-micro focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/30",
        "aria-invalid:border-error aria-invalid:ring-error/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
