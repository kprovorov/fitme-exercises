# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this repo is

`fitme-exercises` is the private content repo of the **Exercise Library**: its content (metadata and markdown) and media (Git LFS), the loader that validates it, and the tooling that publishes it as a `library.json` bundle. The Exercise Library API isn't here: it's `apps/exercises` in the Fitme monorepo (served from `exercises.fitmeproject.com`), built from the bundle this repo publishes. Same tooling as the monorepo: pnpm, Node 24, TypeScript, vitest, ultracite (Biome).

```
exercises/<slug>/         one folder per Exercise, named after its Exercise slug (see Content layout)
src/library/load.ts       loadLibrary(dir): the validated Exercise Library or a list of problems
src/library/bundle.ts     bundleLibrary(dir): the library.json bundle or the loader's problems
src/library/media.ts      reads a media file: a Git LFS pointer (oid, size) or downloaded content (checked)
src/library/mp4.ts        checks an MP4's box structure, brand and video track
src/library/schema.ts     zod schemas for the metadata files
src/library/muscle-groups.ts  the muscle group enum, mirroring @fitme/core
src/library/upload-plan.ts   planUploads(media, existingKeys): the media objects a release uploads (pure)
src/validate.ts           pnpm validate: runs the loader and prints "valid" or every problem
src/bundle.ts             pnpm bundle: writes library.json
src/release.ts            pnpm release plan|upload|publish: the release's S3 and Blob steps
fixtures/library/         a pointer-only copy of the fixture Exercises; fixtures/library.json is its expected bundle
scripts/check-exercise-slugs.sh  PR CI: fails when an Exercise folder on the base branch is deleted or renamed
.github/workflows/ci.yml  PR CI: lint, slugs, typecheck, tests, validation, bundle (no LFS download)
.github/workflows/release.yml  the release, on every push to main (see Releases)
```

## Commands

```bash
pnpm install
pnpm check / pnpm fix    # ultracite (Biome)
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest
pnpm exec vitest run src/library/load.test.ts  # a single test file
pnpm validate [dir]      # validate the Exercise Library (default: exercises/)
pnpm validate --require-lfs-pointers  # as CI: every media file must be an LFS pointer
pnpm bundle [out]        # bundle exercises/ as library.json (default: dist/library.json)
scripts/check-exercise-slugs.sh [base-ref]  # as CI; default base origin/main
pnpm release plan|upload|publish  # the release's steps; only the release workflow runs them
```

## The library.json bundle

`pnpm bundle` is how the Exercise Library leaves this repo: the release (every merge to `main`, see Releases) publishes its output, and `apps/exercises`' build validates it against its own zod schema (`apps/exercises/src/bundle.ts` in the monorepo) and bakes it in. The bundle is the contract between the two repos:

```json
{
  "version": 1,
  "exercises": [
    {
      "slug": "bench-press",
      "muscle_groups": ["chest", "triceps"],
      "locales": { "en": { "name": "Bench Press", "description": "…", "instructions": "…" } },
      "thumbnail": { "oid": "<sha256>", "extension": "png" },
      "video": { "oid": "<sha256>", "extension": "mp4" }
    }
  ]
}
```

- No URLs, sizes or paths: both sides derive a media object's path as `<slug>/<oid>.<ext>`, and the API resolves URLs on its Supabase project.
- Exercises are sorted by Exercise slug.
- **Reads only LFS pointers:** every media file must be a pointer, so bundling never reads LFS content. Bundle from a checkout made with `GIT_LFS_SKIP_SMUDGE=1` (as CI does); with LFS content checked out, every media file is a problem. The release bundles first, before it pulls the LFS content it uploads. An invalid Exercise Library prints the loader's problems and exits 1, like `pnpm validate`.
- A format change touches both repos: the monorepo's schema first (it rejects anything it doesn't know), then `src/library/bundle.ts` here. `src/library/bundle.test.ts` bundles `fixtures/library/` and compares the result with `fixtures/library.json`, a copy of the monorepo's `apps/exercises/fixtures/library.json`: keep the two copies equal.

## Adding an Exercise

1. `git lfs install` (once per machine).
2. Add `exercises/<slug>/` as in Content layout: both metadata files, the two markdown files, a thumbnail and a video.
3. `pnpm validate`: with the media content present, this also checks the thumbnail's pixel limit and decodes both files.
4. Commit and open a pull request. CI validates it from the pointers. Merging it to `main` is a content release (see Releases).

## Releases

Merging a pull request to `main` is a content release. `.github/workflows/release.yml` runs it, one release at a time (a `concurrency` group that never cancels a running release; of several queued releases only the newest runs, and it carries every earlier merge's content), strictly in this order, so a live deployment never points at media that isn't uploaded:

1. **CI** (`ci.yml`, called as is): lint, typecheck, tests, validation and bundle, from the pointers.
2. **Bundle** `dist/library.json` (`pnpm bundle`), while the checkout still has only pointers.
3. **Plan** (`pnpm release plan`): lists the `exercise-media` bucket and plans every media object missing from it (`planUploads` in `src/library/upload-plan.ts`) to `dist/upload-plan.json`.
4. **Pull** only the planned files' LFS objects (`git lfs pull --include`), never the whole LFS store, and `pnpm validate` them with their content (pixel limit, decoding).
5. **Upload** them (`pnpm release upload`) through Supabase's S3 endpoint, after checking each file's sha256 against its oid.
6. **Publish** `dist/library.json` to the private Blob store as `library.json`, overwriting the previous one (`pnpm release publish`). First it checks the release's commit is still `main`'s head: a re-run of an older release fails there instead of publishing stale content over a newer release's.
7. **Redeploy:** `POST` the Vercel deploy hook. Vercel rebuilds the monorepo's `main`, whose `apps/exercises` build fetches the new `library.json` and bakes it in. It reads the blob with `useCache: false`, from origin storage rather than the Blob CDN, so it gets the bundle just published even though the pathname is overwritten.

- **Media objects** live at `<slug>/<oid>.<ext>` with their content type and `Cache-Control: public, max-age=31536000, immutable`. The path is part of the contract with `apps/exercises`, which builds the same paths into its media URLs (`mediaObjectPath` in `src/served-library.ts` in the monorepo): change both together. Objects already in the bucket are skipped; nothing is ever overwritten or deleted, so every earlier deployment's media stays available.
- **Failures and re-runs:** any failing step stops the release, so a failed upload never publishes the bundle. Re-running the latest release is safe: uploaded objects are skipped, and publishing the bundle and calling the hook are idempotent.
- **The release ends when the build is queued:** the hook answers with a pending job, and the workflow fails only if the hook doesn't queue one. Whether the build succeeds shows in the `fitme-exercises` Vercel project (a failed production deployment notifies there), and production stays on the previous deployment until one does. Once the cause is fixed, redeploy from Vercel or re-run the release.
- **Configuration** (GitHub Actions): the variables `SUPABASE_S3_ENDPOINT` (the full S3 endpoint, `https://<host>/storage/v1/s3`) and `SUPABASE_S3_REGION`; the secrets `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY` (an S3 access key, never the service role), `BLOB_READ_WRITE_TOKEN` and `EXERCISES_DEPLOY_HOOK_URL`. Nothing from the monorepo is checked out or run here.
- **Rollback:** Vercel's instant rollback on the `fitme-exercises` Vercel project (the monorepo's `apps/exercises`) restores the previous deployment, content included: each deployment carries its own copy of the Exercise Library, and its media is still in the bucket. That is temporary: the next release (or monorepo deploy) builds from the latest `library.json` again. Undoing content for good is a revert pull request here, which releases again.

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
    original.mp4               optional high resolution source; at most 100 MB (Git LFS), not published
```

- **Exercise slug rules:** the folder name is the Exercise slug. It matches `^[a-z0-9]+(-[a-z0-9]+)*$`: lowercase letters and digits, words joined by single hyphens, no leading, trailing or doubled hyphens. It is permanent: never rename or delete an Exercise folder (Plans and Workout Sessions refer to it). PR CI fails when an Exercise folder present on the base branch is deleted or renamed, listing the missing Exercise slugs; there is no override. Change the display name in `en/metadata.json` instead.
- Muscle groups must come from `src/library/muscle-groups.ts`, at least one, no repeats. That enum mirrors `muscleGroups` in the monorepo's `@fitme/core`: a new muscle group goes into `@fitme/core` first (the API rejects a bundle with a muscle group it doesn't know), then into the enum here.
- Metadata and markdown files must be valid UTF-8. Metadata files are strict: unknown keys are problems. New fields are added to the schema first.
- Media extensions are lowercase: `thumbnail.jpg` (not `.jpeg` or `.JPG`), `thumbnail.png`, `thumbnail.webp`, `video.mp4`. Exactly one thumbnail and one video per Exercise.
- An Exercise folder holds only `metadata.json`, `en/`, a thumbnail, a video and an optional `original.mp4`; a locale folder holds only its three files. Originals are validated (including the CI LFS-pointer requirement) but excluded from the served media, release uploads and bundle. Anything else is an unexpected file. Symlinks aren't allowed anywhere in an Exercise.
- Files and folders starting with `.` are ignored. Anything else at the top of `exercises/` that isn't a folder (including a symlink) is a problem.

Every problem names the Exercise and the file, e.g. `bench-press/metadata.json: unknown muscle group "neck"`.

## Media and Git LFS

Media (`exercises/**/*.{jpg,png,webp,mp4}`) is tracked with Git LFS (`.gitattributes`). Install Git LFS before adding media (`git lfs install`).

- **Content hash = the Git LFS oid.** With LFS content not downloaded (CI, or `GIT_LFS_SKIP_SMUDGE=1`), each media file in the working tree is a pointer; the loader reads `oid` and `size` from it and never downloads anything. With LFS content downloaded (a normal clone with Git LFS installed), the loader hashes the file with sha256, which is exactly how Git LFS defines the oid, so both give the same value.
- **Size limits** use the pointer's `size` (or the file size), so they are always checked. 1 MB is 1,000,000 bytes.
- **The 50 megapixel limit** needs the image's pixel dimensions, which a pointer doesn't carry. It is checked only when the image's content is present locally: on a content author's machine (where the thumbnail is added) and wherever LFS objects are fetched (the release workflow fetches the objects it uploads). PR CI, which never downloads LFS content, checks it only through the size limit. The same goes for the content checks: a thumbnail must decode (sharp) and match its extension, and a video must be a structurally valid MP4 (an MP4 brand in `ftyp`) with a video track that has a sample description and at least one sample (samples are not decoded; fragmented MP4 is not supported).
- **CI requires pointers.** PR CI runs `pnpm validate --require-lfs-pointers` and `pnpm bundle`: a media file that checks out as content rather than a pointer there was committed without Git LFS, and is a problem. Locally the same problem means LFS content is checked out.
- Exercise folders and their media files are loaded sequentially, so downloaded media never piles up in memory. An optional original can be up to 100 MB.
- Pointer-only test Exercises live in `fixtures/library/` with the matching `fixtures/library.json` bundle.

## Glossary

**Exercise**:
A named movement from the Exercise Library, independent of any User. Identified by its Exercise slug.

**Exercise Library**:
The shared collection of every Exercise, with its metadata, text and media. This repo is its home; the Exercise Library API (`apps/exercises` in the monorepo) serves it.
_Avoid_: exercise database, exercises table

**Exercise slug**:
The permanent, readable identifier of an Exercise (`bench-press`): lowercase letters and digits joined by single hyphens. It is the name of the Exercise's folder and never changes, even when the Exercise's name does.
_Avoid_: exercise id, uuid
