import { createRoute, type Hook, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Env } from "hono";
import { ErrorResponse, Exercise, ExercisePage, MuscleGroup } from "../schemas";
import type { ServedLibrary } from "../served-library";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const listExercises = createRoute({
  method: "get",
  path: "/exercises",
  request: {
    query: z.object({
      limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .default(DEFAULT_LIMIT)
        .openapi({ description: "Page size.", example: DEFAULT_LIMIT }),
      muscle_group: MuscleGroup.optional().openapi({
        param: { description: "Only Exercises with this muscle group." },
      }),
      offset: z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        // coercion turns null into 0, which the generator reads as nullable:
        // a query parameter is never null, so the type is given explicitly
        .openapi({
          default: 0,
          description: "How many matches to skip.",
          example: 0,
          minimum: 0,
          type: "integer",
        }),
      search: z.string().optional().openapi({
        description:
          "Case-insensitive substring of the name; `%` and `_` match only themselves.",
        example: "bench",
      }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: ExercisePage } },
      description: "One page of matching Exercises, alphabetical by name",
    },
    400: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "An invalid query parameter",
    },
  },
  summary: "List Exercises",
});

const getExercise = createRoute({
  method: "get",
  path: "/exercises/{slug}",
  request: {
    params: z.object({
      slug: z.string().openapi({ example: "bench-press" }),
    }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: Exercise } },
      description: "The Exercise",
    },
    404: {
      content: { "application/json": { schema: ErrorResponse } },
      description: "No Exercise has this Exercise slug",
    },
  },
  summary: "Get one Exercise by Exercise slug",
});

/** Answers a request that fails validation with 400 in the error shape. */
const invalidRequest: Hook<unknown, Env, string, unknown> = (result, c) => {
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    return c.json({ error: { code: "invalid_request", message } }, 400);
  }
};

export const exerciseRoutes = (library: ServedLibrary) => {
  const bySlug = new Map(
    library.exercises.map((exercise) => [exercise.slug, exercise])
  );
  const summaries = library.exercises.map(
    ({ description: _, instructions: __, ...summary }) => summary
  );

  return new OpenAPIHono({ defaultHook: invalidRequest })
    .openapi(listExercises, (c) => {
      const { limit, muscle_group, offset, search } = c.req.valid("query");
      const term = search?.toLowerCase();
      const matches = summaries.filter(
        (summary, i) =>
          (!term || library.searchNames[i]?.includes(term)) &&
          (!muscle_group || summary.muscle_groups.includes(muscle_group))
      );
      const data = matches.slice(offset, offset + limit);
      const total = matches.length;
      return c.json(
        { data, hasMore: offset + data.length < total, total },
        200
      );
    })
    .openapi(getExercise, (c) => {
      const exercise = bySlug.get(c.req.valid("param").slug);
      if (!exercise) {
        return c.json(
          { error: { code: "not_found", message: "Exercise not found" } },
          404
        );
      }
      return c.json(exercise, 200);
    });
};
