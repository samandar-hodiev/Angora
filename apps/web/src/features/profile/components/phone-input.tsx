"use client";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { COUNTRIES } from "@/lib/phone";

/**
 * Country + national number. The country provides the dialling code; the value is converted
 * to E.164 on submit. Props named like native inputs so FormField can wire labels and errors.
 */
export function PhoneInput({
  id,
  country,
  number,
  onCountryChange,
  onNumberChange,
  disabled,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: {
  id?: string;
  country: string;
  number: string;
  onCountryChange: (code: string) => void;
  onNumberChange: (value: string) => void;
  disabled?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
      <NativeSelect aria-label="Country" value={country} disabled={disabled} onChange={(e) => onCountryChange(e.target.value)}>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name} ({c.dial})
          </option>
        ))}
      </NativeSelect>
      <Input
        id={id}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="90 123 45 67"
        value={number}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onNumberChange(e.target.value)}
      />
    </div>
  );
}
