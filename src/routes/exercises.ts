import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { ErrorResponse, Exercise } from "../schemas";
import type { ServedLibrary } from "../served-library";

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

export const exerciseRoutes = (library: ServedLibrary) => {
  const bySlug = new Map(
    library.exercises.map((exercise) => [exercise.slug, exercise])
  );

  return new OpenAPIHono().openapi(getExercise, (c) => {
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
