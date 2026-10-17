import { createApp } from "./create-app";
import { library } from "./generated/library";

// Vercel's Hono preset serves the default export of dist/app.js.
export default createApp({ library });
