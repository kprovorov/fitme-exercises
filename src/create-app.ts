import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { exerciseRoutes } from "./routes/exercises";
import type { ServedLibrary } from "./served-library";

export interface AppDeps {
  /** The whole Exercise Library, baked into the build: nothing is read at runtime. */
  library: ServedLibrary;
}

/** The Exercise Library API. Only /health is public. */
export const createApp = ({ library }: AppDeps) => {
  const app = new OpenAPIHono();

  app.use(logger());

  app.get("/health", (c) => c.json({ ok: true }));

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
