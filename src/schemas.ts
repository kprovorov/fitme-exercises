import { z } from "@hono/zod-openapi";
import { muscleGroups } from "./library/muscle-groups";

/** The muscle group enum, one named schema wherever it appears. */
export const MuscleGroup = z.enum(muscleGroups).openapi("MuscleGroup");

/**
 * The one field definition every response is built from: `ExerciseSummary`
 * (lists and batch lookups) and `Exercise` (the single lookup) share these
 * fields, so adding a field is one change here.
 */
const summaryFields = {
  muscle_groups: z.array(MuscleGroup),
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

export const ExercisePage = z
  .object({
    data: z.array(ExerciseSummary),
    hasMore: z
      .boolean()
      .openapi({ description: "Whether more matches follow this page." }),
    total: z.int().openapi({
      description: "How many Exercises match, across every page.",
    }),
  })
  .openapi("ExercisePage");

export const ExerciseBatch = z
  .object({
    data: z.array(ExerciseSummary).openapi({
      description: "The Exercises found, in the order their slugs were asked.",
    }),
    missing: z.array(z.string()).openapi({
      description: "The asked Exercise slugs no Exercise has, in asked order.",
      example: ["no-such-exercise"],
    }),
  })
  .openapi("ExerciseBatch");

export type ExerciseSummary = z.infer<typeof ExerciseSummary>;
export type Exercise = z.infer<typeof Exercise>;
export type ExercisePage = z.infer<typeof ExercisePage>;
export type ExerciseBatch = z.infer<typeof ExerciseBatch>;

export const ErrorResponse = z
  .object({
    error: z.object({
      code: z.string().openapi({ example: "not_found" }),
      message: z.string(),
    }),
  })
  .openapi("Error");
