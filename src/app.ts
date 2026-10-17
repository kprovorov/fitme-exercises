// Vercel's Hono preset only accepts an entrypoint that imports "hono" itself,
// and dist/app.js otherwise imports only @hono/zod-openapi and hono/* subpaths.
import "hono";
import { createApp } from "./create-app";
import { library } from "./generated/library";

// Vercel's Hono preset serves the default export of dist/app.js.
export default createApp({ library });
