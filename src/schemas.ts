import { z } from "@hono/zod-openapi";
import { muscleGroups } from "./library/muscle-groups";

/**
 * The one field definition every response is built from: `ExerciseSummary`
 * (lists and batch lookups) and `Exercise` (the single lookup) share these
 * fields, so adding a field is one change here.
 */
const summaryFields = {
  muscle_groups: z.array(z.enum(muscleGroups).openapi("MuscleGroup")),
  name: z.string().openapi({ example: "Bench Press" }),
  slug: z.string().openapi({ example: "bench-press" }),
  thumbnail_url: z.url().openapi({
    description:
      "The thumbnail through Supabase's image transformation endpoint: append `width` and/or `height` query parameters.",
  }),
  video_url: z.url().openapi({ description: "The public video URL (mp4)." }),
};

export const ExerciseSummary = z
  .object(summaryFields)
  .openapi("ExerciseSummary");

export const Exercise = z
  .object({
    ...summaryFields,
    description: z.string().openapi({ description: "Markdown." }),
    instructions: z.string().openapi({ description: "Markdown." }),
  })
  .openapi("Exercise");

export type ExerciseSummary = z.infer<typeof ExerciseSummary>;
export type Exercise = z.infer<typeof Exercise>;

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string(),
    }),
  })
  .openapi("Error");
