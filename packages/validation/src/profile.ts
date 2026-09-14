import { z } from "zod";

import { DISPLAY_NAME_MAX } from "./auth";

/**
 * Partial profile update, mirroring apps/api/internal/profiles UpdateInput.
 * Level codes are not enumerated here: valid levels come from GET /api/v1/learning/levels.
 */
export const profileUpdateSchema = z.object({
  display_name: z.string().trim().min(1, "Name is required").max(DISPLAY_NAME_MAX).optional(),
  native_language: z.string().min(2).max(16).optional(),
  timezone: z.string().max(64).optional(),
  current_level: z.string().max(8).optional(),
  target_level: z.string().max(8).optional(),
  learning_goals: z.array(z.string().min(1).max(64)).max(10, "Choose at most 10 goals").optional(),
  daily_goal_minutes: z
    .number()
    .int()
    .min(5, "Daily goal must be at least 5 minutes")
    .max(240, "Daily goal must be at most 240 minutes")
    .optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
  complete_onboarding: z.boolean().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
