import { z } from "zod";

import { emailSchema, PASSWORD_MAX, PASSWORD_MIN } from "./auth";

/**
 * Schemas for the new-learner journey (email verification, profile setup). They mirror the
 * API's validation for fast feedback; the API validates everything again.
 */

export const emailStartSchema = z.object({ email: emailSchema });
export type EmailStartInput = z.infer<typeof emailStartSchema>;

export const OTP_LENGTH = 6;
export const otpSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

/** Mirrors the API: at least 8 characters with a letter and a number. */
export const strongPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`)
  .refine((v) => /\p{L}/u.test(v) && /\d/.test(v), "Use at least one letter and one number");

export const NAME_MAX = 50;

export const profileSetupSchema = z
  .object({
    first_name: z.string().trim().min(1, "First name is required").max(NAME_MAX, `Use at most ${NAME_MAX} characters`),
    last_name: z.string().trim().max(NAME_MAX, `Use at most ${NAME_MAX} characters`),
    phone_country: z.string().length(2, "Choose a country"),
    phone_number: z
      .string()
      .trim()
      .max(20, "Phone number is too long")
      .refine((v) => v === "" || /^\+?[\d\s().-]{4,20}$/.test(v), "Enter a valid phone number"),
    password: z.string(),
    confirm_password: z.string(),
    /** Accounts created with an email code need a password to sign in again. */
    password_required: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (!v.password_required && v.password === "") return;
    const strength = strongPasswordSchema.safeParse(v.password);
    if (!strength.success) {
      ctx.addIssue({ code: "custom", path: ["password"], message: strength.error.issues[0]?.message ?? "Choose a stronger password" });
    } else if (v.password !== v.confirm_password) {
      ctx.addIssue({ code: "custom", path: ["confirm_password"], message: "Passwords do not match" });
    }
  });

export type ProfileSetupValues = z.infer<typeof profileSetupSchema>;
