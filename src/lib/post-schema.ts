import { z } from "zod";
import { CITIES } from "./cities";

const CITY_SLUGS = CITIES.map((city) => city.slug) as [typeof CITIES[number]["slug"], ...typeof CITIES[number]["slug"][]];

export const POST_TAGS = ["General", "Food", "Jobs", "Rent", "Events", "Question"] as const;

export const citySlugSchema = z.enum(CITY_SLUGS);
export const postTagSchema = z.enum(POST_TAGS);
export const postTitleSchema = z.string().trim().min(1, "Post title is required").max(140, "Post title must be 140 characters or fewer");
export const postBodySchema = z.string().trim().min(1, "Post details are required").max(4000, "Post details must be 4000 characters or fewer");

export const postDraftSchema = z.object({
  city: citySlugSchema,
  title: postTitleSchema,
  body: postBodySchema,
  tag: postTagSchema,
}).strict();

export const postEditSchema = postDraftSchema.pick({ title: true, body: true }).strict();

export const commentDraftSchema = z.object({
  body: z.string().trim().min(1, "Comment is required").max(1000, "Comment must be 1000 characters or fewer"),
}).strict();

export const messageDraftSchema = z.object({
  body: z.string().trim().min(1, "Message is required").max(2000, "Message must be 2000 characters or fewer"),
}).strict();

export const postValidationRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    post: postDraftSchema,
  }).strict(),
  z.object({
    operation: z.literal("edit"),
    post: postEditSchema,
  }).strict(),
]);

export type PostTag = z.infer<typeof postTagSchema>;
export type PostDraft = z.infer<typeof postDraftSchema>;
