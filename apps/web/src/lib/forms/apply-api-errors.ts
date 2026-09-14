import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { errorMessage, isApiError } from "@/lib/api/errors";

/**
 * Maps API validation errors onto form fields. Returns a form-level message for anything
 * that could not be attached to a field (or null when every error was attached).
 */
export function applyApiErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): string | null {
  if (!isApiError(error)) return errorMessage(error);

  let unmatched = false;
  const fieldErrors = error.fieldErrors;
  for (const [field, message] of Object.entries(fieldErrors)) {
    if ((fields as readonly string[]).includes(field)) {
      setError(field as Path<T>, { type: "server", message: capitalize(message) });
    } else {
      unmatched = true;
    }
  }
  if (Object.keys(fieldErrors).length === 0 || unmatched) {
    return error.message;
  }
  return null;
}

function capitalize(message: string): string {
  return message.charAt(0).toUpperCase() + message.slice(1);
}
