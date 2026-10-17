# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this repo is

`fitme-exercises` owns the **Exercise Library**: its content (metadata and markdown) and media (Git LFS), the loader that validates it, and (later) the Exercise Library API served from `exercises.fitmeproject.com`. It sits next to the main Fitme monorepo and uses the same tooling: pnpm, Node 24, TypeScript, vitest, ultracite (Biome).

```
exercises/<slug>/         one folder per Exercise, named after its Exercise slug (see Content layout)
src/library/load.ts       loadLibrary(dir): the validated Exercise Library or a list of problems
src/library/media.ts      reads a media file: a Git LFS pointer (oid, size) or downloaded content
src/library/schema.ts     zod schemas for the metadata files
src/library/muscle-groups.ts  the muscle group enum: the source of truth
src/validate.ts           pnpm validate: runs the loader and prints "valid" or every problem
.github/workflows/ci.yml  PR CI: lint, typecheck, tests, validation (no LFS download)
```

## Commands

```bash
pnpm install
pnpm check / pnpm fix    # ultracite (Biome)
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest
pnpm exec vitest run src/library/load.test.ts  # a single test file
pnpm validate [dir]      # validate the Exercise Library (default: exercises/)
```

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

- **Exercise slug rules:** the folder name is the Exercise slug. It matches `^[a-z0-9]+(-[a-z0-9]+)*$`: lowercase letters and digits, words joined by single hyphens, no leading, trailing or doubled hyphens. It is permanent: never rename or delete an Exercise folder (Plans and Workout Sessions refer to it). Change the display name in `en/metadata.json` instead.
- Muscle groups must come from `src/library/muscle-groups.ts`, at least one, no repeats.
- Metadata files are strict: unknown keys are problems. New fields are added to the schema first.
- Media extensions are lowercase: `thumbnail.jpg` (not `.jpeg` or `.JPG`), `thumbnail.png`, `thumbnail.webp`, `video.mp4`. Exactly one thumbnail and one video per Exercise.
- Files and folders starting with `.` are ignored. Anything else at the top of `exercises/` that isn't a folder is a problem.

Every problem names the Exercise and the file, e.g. `bench-press/metadata.json: unknown muscle group "neck"`.

## Media and Git LFS

Media (`exercises/**/*.{jpg,png,webp,mp4}`) is tracked with Git LFS (`.gitattributes`). Install Git LFS before adding media (`git lfs install`).

- **Content hash = the Git LFS oid.** With LFS content not downloaded (CI, or `GIT_LFS_SKIP_SMUDGE=1`), each media file in the working tree is a pointer; the loader reads `oid` and `size` from it and never downloads anything. With LFS content downloaded (a normal clone with Git LFS installed), the loader hashes the file with sha256, which is exactly how Git LFS defines the oid, so both give the same value.
- **Size limits** use the pointer's `size` (or the file size), so they are always checked.
- **The 50 megapixel limit** needs the image's pixel dimensions, which a pointer doesn't carry. It is checked only when the image's content is present locally: on a content author's machine (where the thumbnail is added) and wherever LFS objects are fetched (the release workflow fetches the objects it uploads). PR CI, which never downloads LFS content, checks it only through the size limit. The same goes for the check that an image's content matches its extension.
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
