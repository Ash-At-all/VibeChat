import { z } from "zod";

export const profileSchema = z.object({
  username: z.string()
    .min(2, "Username must be at least 2 characters.")
    .max(30, "Username must be 30 characters or fewer.")
    .regex(
      /^[a-z0-9_]+$/,
      "Username can only contain lowercase letters, numbers, and underscores.",
    ),
  display_name: z.string()
    .max(60, "Display name must be 60 characters or fewer.")
    .optional()
    .default(""),
  tag: z.string()
    .max(40, "Tag must be 40 characters or fewer.")
    .optional()
    .nullable(),
  avatar_url: z.string().url().optional().nullable(),
}).strict();

export type ProfileDraft = z.infer<typeof profileSchema>;

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  tag: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};
