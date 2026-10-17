import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { deviceCache } from "./cache";
import { exerciseRoutes } from "./routes/exercises";
import type { ServedLibrary } from "./served-library";

export interface AppDeps {
  /** The whole Exercise Library, baked into the build: nothing is read at runtime. */
  library: ServedLibrary;
}

const health = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ ok: z.boolean() }) },
      },
      description: "The API is up",
    },
  },
  summary: "Liveness",
});

/** The Exercise Library API, serving the injected Exercise Library. */
export const createApp = ({ library }: AppDeps) => {
  const app = new OpenAPIHono();

  app.use(logger());

  app.openapi(health, (c) => c.json({ ok: true }, 200));

  // Every content route, current and future, lives under /exercises.
  app.use("/exercises/*", deviceCache(library.hash));
  app.route("/", exerciseRoutes(library));

  app.notFound((c) =>
    c.json({ error: { code: "not_found", message: "Route not found" } }, 404)
  );

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json(
        { error: { code: "http_error", message: error.message } },
        error.status
      );
    }
    console.error(error);
    return c.json(
      { error: { code: "internal_error", message: "Internal server error" } },
      500
    );
  });

  return app;
};
