import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import {
  type AuthConfig,
  type AuthEnv,
  BEARER_AUTH,
  requireCaller,
} from "./auth";
import { deviceCache } from "./cache";
import { exerciseRoutes } from "./routes/exercises";
import type { ServedLibrary } from "./served-library";

export interface AppDeps {
  /** The Clerk keys and server secrets a caller can prove who they are with. */
  auth: AuthConfig;
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
export const createApp = ({ auth, library }: AppDeps) => {
  const app = new OpenAPIHono<AuthEnv>();

  app.use(logger());

  // Registered before auth, so it answers without a token.
  app.openapi(health, (c) => c.json({ ok: true }, 200));

  // Every route from here on (unknown ones too) needs a caller.
  app.use(requireCaller(auth));
  app.openAPIRegistry.registerComponent("securitySchemes", BEARER_AUTH, {
    description: "A Clerk session token, or the Coach's or MCP server's secret",
    scheme: "bearer",
    type: "http",
  });

  // Every content route, current and future, lives under /exercises. After
  // auth, so a 304 only ever goes to a caller.
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
