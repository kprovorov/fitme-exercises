# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this repo is

`fitme-exercises` owns the **Exercise Library**: its content (metadata and markdown) and media (Git LFS), the loader that validates it, and the Exercise Library API (served from `exercises.fitmeproject.com` once deployed). It sits next to the main Fitme monorepo and uses the same tooling: pnpm, Node 24, TypeScript, vitest, ultracite (Biome).

```
exercises/<slug>/         one folder per Exercise, named after its Exercise slug (see Content layout)
src/library/load.ts       loadLibrary(dir): the validated Exercise Library or a list of problems
src/library/media.ts      reads a media file: a Git LFS pointer (oid, size) or downloaded content (checked)
src/library/mp4.ts        checks an MP4's box structure, brand and video track
src/library/schema.ts     zod schemas for the metadata files
src/library/muscle-groups.ts  the muscle group enum: the source of truth
src/validate.ts           pnpm validate: runs the loader and prints "valid" or every problem
src/generate.ts           pnpm generate: writes src/generated/library.ts (git-ignored), the Exercise Library the API serves
src/build/library-module.ts  loader → generated module source, media URLs resolved; problems fail the build
src/served-library.ts     ServedLibrary (with the library hash) and the media URLs (bucket exercise-media, <slug>/<lfs-oid>.<ext>)
src/cache.ts              deviceCache: Cache-Control, the library-hash ETag and 304 on every content route
src/schemas.ts            zod-openapi response schemas: the one field definition (ExerciseSummary, Exercise)
src/create-app.ts         createApp({ library }): the Hono app (routes in src/routes/), JSON 404/500 handlers
src/app.ts                default export createApp() with the generated library: Vercel's entrypoint
src/index.ts              Node server (pnpm dev, pnpm start)
src/openapi.ts            pnpm openapi: writes openapi.json, the committed OpenAPI spec (not served)
scripts/check-api-breaking.sh  PR CI: oasdiff breaking-change check of openapi.json against the base branch
scripts/check-exercise-slugs.sh  PR CI: fails when an Exercise folder on the base branch is deleted or renamed
.github/oasdiff/          oasdiff config: severity-levels.txt, allowed-breaking-changes.txt (the override)
.github/workflows/ci.yml  PR CI: lint, API contract, slugs, typecheck, tests, validation (no LFS download)
```

## Commands

```bash
pnpm install
pnpm check / pnpm fix    # ultracite (Biome)
pnpm typecheck           # tsc --noEmit (needs src/generated: run pnpm generate first)
pnpm test                # vitest
pnpm exec vitest run src/library/load.test.ts  # a single test file
pnpm validate [dir]      # validate the Exercise Library (default: exercises/)
pnpm validate --require-lfs-pointers  # as CI: every media file must be an LFS pointer
pnpm dev                 # generate, then serve the API on http://localhost:3005 (tsx watch)
pnpm build               # generate, then bundle with tsdown → dist/ (dist/app.js for Vercel)
pnpm start               # run dist/node/index.js
pnpm openapi             # regenerate openapi.json (commit it with any API change)
scripts/check-api-breaking.sh [base-ref]    # as CI (needs oasdiff and jq); default base origin/main
scripts/check-exercise-slugs.sh [base-ref]  # as CI; default base origin/main
```

`pnpm generate` (run by `pnpm dev` and `pnpm build`) needs `SUPABASE_URL`, the https URL of the Supabase project whose `exercise-media` bucket holds the media; put it in `.env.local` (see `.env.example`). It fails on an invalid Exercise Library. Re-run it (or restart `pnpm dev`) after changing content: the API never reads `exercises/` at runtime.

## Exercise Library API

- `GET /health`: public liveness.
- `GET /exercises`: `{ data: ExerciseSummary[], total, hasMore }`, alphabetical by name. Query: `search` (case-insensitive substring of the name, trimmed, at most 100 characters, matched against the lowercased name index built by `pnpm generate`; `%` and `_` are literal), `muscle_group` (the enum), `limit` (1–50, default 20), `offset` (default 0). An offset past the end is an empty page; an invalid parameter is `400` (`invalid_request`).
- `GET /exercises/:slug`: the `Exercise`, or `404`.
- Errors are `{ error: { code, message } }`, like the monorepo's `apps/api`.
- Caching: every successful content response (everything under `/exercises`) carries `Cache-Control: private, max-age=3600` and `ETag: "<library hash>"`, the sha256 of every Exercise as served, so any change to text, muscle groups or media changes it. A matching `If-None-Match` answers `304` with no body. Errors and `/health` carry neither. Add content routes under `/exercises` so they're covered. The ETag only changes with the library, so every response body must be derived from `ServedLibrary`: a code-only change to an existing response's shape would be served stale to devices through `304`. Add fields through `serveLibrary` (and `src/schemas.ts`).
- `thumbnail_url` is Supabase's image transformation (render) endpoint for the object: clients append `width`/`height`. `video_url` is the public object URL. Both are built from the LFS oid, so a URL changes whenever the content does.
- Response fields are defined once in `src/schemas.ts`; add a field there. Changes are additive only (no version prefix): see API contract.
- Tests drive `createApp` through `app.request` with fixture Exercises (`src/app.test.ts`).

## API contract

`openapi.json` is generated from the zod-openapi route definitions by `pnpm openapi` and committed; it isn't served. PR CI fails when:

- **It's stale:** regenerating it changes it. Run `pnpm openapi` and commit the result with every API change.
- **It breaks the contract:** oasdiff compares it with the base branch's and fails on any breaking change, error or warning: a removed or renamed route, response field or parameter, a narrowed type, a new required parameter. Installed app builds read this API and there's no version prefix, so changes are additive only. Every removal counts, including an optional response field and anything deprecated first (`.github/oasdiff/severity-levels.txt` raises those to warnings). New optional parameters, new routes and new response fields are fine. A new muscle group (a new value of the `muscle_groups` response enum) is the one allowed enum addition: clients must tolerate muscle groups they don't know. Any other response enum stays closed.

**Deliberate removal (the override).** A field, parameter or route is removed only after the app's minimum version gate has cut off every build that reads it. Then, in the removal PR, copy each line the check prints (without the trailing `[check id]`) into `.github/oasdiff/allowed-breaking-changes.txt`: `<METHOD> <path> <message>`, e.g. ``GET /exercises/{slug} removed the required property `video_url` from the response with the `200` status``. The line allows exactly that change, and is reviewed with the PR: say which minimum app version made it safe. Never add a line to get an unplanned change through, and never loosen the check another way. Empty the file again in a later PR once the removal is on `main`.

## Content layout

```
exercises/
  bench-press/                 the Exercise slug
    metadata.json              { "muscle_groups": ["chest", "triceps"] }: language-independent
    en/                        a locale folder (only `en` for now)
      metadata.json            { "name": "Bench Press" }
      description.md
      instructions.md
    thumbnail.png              jpg, png or webp; at most 25 MB and 50 megapixels (Git LFS)
    video.mp4                  mp4; at most 20 MB (Git LFS)
```

- **Exercise slug rules:** the folder name is the Exercise slug. It matches `^[a-z0-9]+(-[a-z0-9]+)*$`: lowercase letters and digits, words joined by single hyphens, no leading, trailing or doubled hyphens. It is permanent: never rename or delete an Exercise folder (Plans and Workout Sessions refer to it). PR CI fails when an Exercise folder present on the base branch is deleted or renamed, listing the missing Exercise slugs; there is no override. Change the display name in `en/metadata.json` instead.
- Muscle groups must come from `src/library/muscle-groups.ts`, at least one, no repeats.
- Metadata and markdown files must be valid UTF-8. Metadata files are strict: unknown keys are problems. New fields are added to the schema first.
- Media extensions are lowercase: `thumbnail.jpg` (not `.jpeg` or `.JPG`), `thumbnail.png`, `thumbnail.webp`, `video.mp4`. Exactly one thumbnail and one video per Exercise.
- An Exercise folder holds only `metadata.json`, `en/`, a thumbnail and a video; a locale folder holds only its three files. Anything else is an unexpected file. Symlinks aren't allowed anywhere in an Exercise.
- Files and folders starting with `.` are ignored. Anything else at the top of `exercises/` that isn't a folder (including a symlink) is a problem.

Every problem names the Exercise and the file, e.g. `bench-press/metadata.json: unknown muscle group "neck"`.

## Media and Git LFS

Media (`exercises/**/*.{jpg,png,webp,mp4}`) is tracked with Git LFS (`.gitattributes`). Install Git LFS before adding media (`git lfs install`).

- **Content hash = the Git LFS oid.** With LFS content not downloaded (CI, or `GIT_LFS_SKIP_SMUDGE=1`), each media file in the working tree is a pointer; the loader reads `oid` and `size` from it and never downloads anything. With LFS content downloaded (a normal clone with Git LFS installed), the loader hashes the file with sha256, which is exactly how Git LFS defines the oid, so both give the same value.
- **Size limits** use the pointer's `size` (or the file size), so they are always checked. 1 MB is 1,000,000 bytes.
- **The 50 megapixel limit** needs the image's pixel dimensions, which a pointer doesn't carry. It is checked only when the image's content is present locally: on a content author's machine (where the thumbnail is added) and wherever LFS objects are fetched (the release workflow fetches the objects it uploads). PR CI, which never downloads LFS content, checks it only through the size limit. The same goes for the content checks: a thumbnail must decode (sharp) and match its extension, and a video must be a structurally valid MP4 (an MP4 brand in `ftyp`) with a video track that has a sample description and at least one sample (samples are not decoded; fragmented MP4 is not supported).
- **CI requires pointers.** PR CI runs `pnpm validate --require-lfs-pointers`: a media file that checks out as content rather than a pointer was committed without Git LFS, and is a problem.
- Exercise folders are loaded one at a time, so downloaded media (up to 45 MB per Exercise) never piles up in memory.
- The fixture Exercises in `exercises/` (`example-*`) are made up, with tiny placeholder media. They are not real content and will be replaced by the real pack.

## Glossary

**Exercise**:
A named movement from the Exercise Library, independent of any User. Identified by its Exercise slug.

**Exercise Library**:
The shared collection of every Exercise, with its metadata, text and media. This repo is its home; it's served by the Exercise Library API.
_Avoid_: exercise database, exercises table

**Exercise slug**:
The permanent, readable identifier of an Exercise (`bench-press`): lowercase letters and digits joined by single hyphens. It is the name of the Exercise's folder and never changes, even when the Exercise's name does.
_Avoid_: exercise id, uuid
