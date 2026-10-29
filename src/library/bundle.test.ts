import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
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

const bundleFiles = async (files: Record<string, string | Uint8Array>) => {
  const { cleanup, dir } = await makeLibraryDir();
  try {
    await writeFiles(dir, files);
    return await bundleLibrary(dir);
  } finally {
    await cleanup();
  }
};

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

  it("bundles the fixture Exercise Library as library.json version 1", async () => {
    // A copy of the monorepo's apps/library/fixtures/library.json: the
    // bundle the API's build accepts for these Exercises.
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
