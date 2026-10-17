// Vercel's Hono preset only accepts an entrypoint that imports "hono" itself,
// and dist/app.js otherwise imports only @hono/zod-openapi and hono/* subpaths.
import "hono";
import { createApp } from "./create-app";
import { library } from "./generated/library";

// Vercel's Hono preset serves the default export of dist/app.js.
export default createApp({
  auth: {
    clerkJwtKeys: {
      development: process.env.CLERK_JWT_KEY_DEVELOPMENT,
      production: process.env.CLERK_JWT_KEY_PRODUCTION,
    },
    serverSecrets: {
      coach: process.env.EXERCISES_COACH_SECRET,
      mcp: process.env.EXERCISES_MCP_SECRET,
    },
  },
  library,
});
