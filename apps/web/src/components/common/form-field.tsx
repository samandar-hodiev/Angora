import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface ControlProps {
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

interface FormFieldProps {
  id: string;
  label: string;
  description?: string;
  error?: string;
  className?: string;
  children: ReactElement<ControlProps>;
}

/**
 * Label + control + description + error, wired for accessibility: the control receives
 * id, aria-invalid and aria-describedby automatically.
 */
export function FormField({ id, label, description, error, className, children }: FormFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  const control = Children.only(children);
  const enhanced: ReactNode = isValidElement(control)
    ? cloneElement(control, { id, "aria-invalid": Boolean(error), "aria-describedby": describedBy })
    : control;

  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {enhanced}
      {description && !error && (
        <p id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
