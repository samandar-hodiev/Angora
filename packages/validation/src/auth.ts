import { z } from "zod";

/**
 * Limits mirror apps/api/internal/auth (RegisterInput/LoginInput binding tags).
 * Client-side validation is for UX only; the API always validates again.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MAX = 80;

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(PASSWORD_MAX, "Password is too long"),
});

export const registerSchema = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(DISPLAY_NAME_MAX, `Name must be at most ${DISPLAY_NAME_MAX} characters`),
    email: emailSchema,
    password: z
      .string()
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
      .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`),
    confirm_password: z.string(),
    timezone: z.string().max(64).optional(),
  })
  .refine((v) => v.password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match",
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
      .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`),
    confirm_password: z.string(),
  })
  .refine((v) => v.password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords do not match",
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** The payload actually sent to POST /api/v1/auth/register. */
export function toRegisterPayload(input: RegisterInput) {
  return {
    display_name: input.display_name,
    email: input.email,
    password: input.password,
    timezone: input.timezone,
  };
}
