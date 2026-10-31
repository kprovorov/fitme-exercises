import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  coverFiles,
  exerciseFiles,
  fakeOid,
  lfsPointer,
  makeLibraryDir,
  prefix,
  TINY_PNG,
  writeFiles,
} from "../test/fixtures";
import { bundleLibrary } from "./bundle";

const FIXTURES = resolve(import.meta.dirname, "../../fixtures");

/** Bundles `exercises` (and `covers`, when given) as the Library's folders. */
const bundleFiles = async (
  exercises: Record<string, string | Uint8Array>,
  covers?: Record<string, string | Uint8Array>
) => {
  const { cleanup, dir } = await makeLibraryDir();
  try {
    await writeFiles(dir, {
      ...prefix("exercises", exercises),
      ...(covers && prefix("covers", covers)),
    });
    return await bundleLibrary(dir);
  } finally {
    await cleanup();
  }
};

const CHEST = "3f2b8a4e-6c1d-4e5f-9a7b-1c2d3e4f5a6b";
const LEGS = "c6e5d4b3-2a1f-4e8d-9c7b-3f4a5b6c7d8e";

describe("bundleLibrary", () => {
  it("keeps archival originals out of the published bundle", async () => {
    const files = prefix("bench-press", exerciseFiles());
    const withoutOriginal = await bundleFiles(files);
    const withOriginal = await bundleFiles({
      ...files,
      "bench-press/original.mp4": lfsPointer(fakeOid("c"), 25_000_000),
    });

    expect(withoutOriginal.ok).toBe(true);
    expect(withOriginal).toEqual(withoutOriginal);
  });

  it("bundles each translation under its locale, and none where it's missing", async () => {
    const result = await bundleFiles({
      ...prefix("bench-press", exerciseFiles()),
      ...prefix("bench-press/uk", {
        "description.md": "Базова жимова вправа.\n",
        "instructions.md": "- Ляжте на лаву.\n",
        "metadata.json": JSON.stringify({ name: "Жим лежачи" }),
      }),
      ...prefix("squat", exerciseFiles()),
    });

    expect(result.ok).toBe(true);
    const exercises: { locales: Record<string, unknown> }[] = result.ok
      ? JSON.parse(result.json).exercises
      : [];
    expect(exercises.map(({ locales }) => Object.keys(locales))).toEqual([
      ["en", "uk"],
      ["en"],
    ]);
    expect(exercises[0].locales.uk).toEqual({
      description: "Базова жимова вправа.\n",
      instructions: "- Ляжте на лаву.\n",
      name: "Жим лежачи",
    });
  });

  it("bundles every Cover by id, with its muscle groups and image", async () => {
    const result = await bundleFiles(prefix("bench-press", exerciseFiles()), {
      ...prefix(LEGS, coverFiles(["quadriceps", "glutes"])),
      ...prefix(CHEST, coverFiles(["chest"])),
    });

    expect(result.ok && JSON.parse(result.json).covers).toEqual([
      {
        id: CHEST,
        image: { extension: "jpg", oid: fakeOid("d") },
        muscle_groups: ["chest"],
      },
      {
        id: LEGS,
        image: { extension: "jpg", oid: fakeOid("d") },
        muscle_groups: ["quadriceps", "glutes"],
      },
    ]);
  });

  it("bundles no Covers when there's no covers folder", async () => {
    const result = await bundleFiles(prefix("bench-press", exerciseFiles()));

    expect(result.ok && JSON.parse(result.json).covers).toEqual([]);
  });

  it("returns a Cover's problems, and an Exercise's, together", async () => {
    const result = await bundleFiles(
      {
        ...prefix("bench-press", exerciseFiles()),
        "bench-press/metadata.json": JSON.stringify({ muscle_groups: [] }),
      },
      {
        ...prefix(CHEST, coverFiles(["neck"])),
        [`${CHEST}/image.jpg`]: TINY_PNG,
      }
    );

    expect(result).toEqual({
      ok: false,
      problems: [
        expect.objectContaining({
          exercise: "bench-press",
          file: "bench-press/metadata.json",
        }),
        expect.objectContaining({
          cover: CHEST,
          file: `${CHEST}/metadata.json`,
        }),
        expect.objectContaining({
          cover: CHEST,
          file: `${CHEST}/image.jpg`,
        }),
      ],
    });
  });

  it("bundles the fixture Library as library.json version 1", async () => {
    // A copy of the monorepo's apps/library/fixtures/library.json: the
    // bundle the API's build accepts for these Exercises and Covers.
    const expected = JSON.parse(
      await readFile(resolve(FIXTURES, "library.json"), "utf8")
    );

    const result = await bundleLibrary(resolve(FIXTURES, "library"));

    expect(result.ok).toBe(true);
    expect(result.ok && JSON.parse(result.json)).toEqual(expected);
  });

  it("returns the loader's problems for an invalid Exercise Library", async () => {
    const result = await bundleFiles({
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/metadata.json": JSON.stringify({ muscle_groups: ["neck"] }),
    });

    expect(result).toEqual({
      ok: false,
      problems: [
        expect.objectContaining({
          exercise: "bench-press",
          file: "bench-press/metadata.json",
        }),
      ],
    });
  });

  it("refuses media whose LFS content is checked out", async () => {
    const result = await bundleFiles({
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.png": TINY_PNG,
    });

    expect(result).toEqual({
      ok: false,
      problems: [
        expect.objectContaining({
          exercise: "bench-press",
          file: "bench-press/thumbnail.png",
        }),
      ],
    });
  });
});
