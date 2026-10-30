import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  coverFiles,
  fakeOid,
  lfsPointer,
  makeLibraryDir,
  prefix,
  writeFiles,
} from "../test/fixtures";
import { loadCovers } from "./covers";

const CHEST = "3f2b8a4e-6c1d-4e5f-9a7b-1c2d3e4f5a6b";
const LEGS = "c6e5d4b3-2a1f-4e8d-9c7b-3f4a5b6c7d8e";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeLibraryDir());
});

afterEach(async () => {
  await cleanup();
});

const problems = async () => {
  const result = await loadCovers(dir, { requireLfsPointers: true });
  return result.ok ? [] : result.problems;
};

describe("loadCovers", () => {
  it("loads every Cover with its id, muscle groups and image, sorted by id", async () => {
    await writeFiles(dir, {
      ...prefix(LEGS, coverFiles(["quadriceps", "glutes"])),
      ...prefix(CHEST, coverFiles(["chest"])),
    });

    const result = await loadCovers(dir, { requireLfsPointers: true });

    expect(result).toEqual({
      covers: [
        {
          id: CHEST,
          image: {
            contentType: "image/jpeg",
            extension: "jpg",
            oid: fakeOid("d"),
            path: `${CHEST}/image.jpg`,
            size: 2048,
          },
          muscle_groups: ["chest"],
        },
        {
          id: LEGS,
          image: {
            contentType: "image/jpeg",
            extension: "jpg",
            oid: fakeOid("d"),
            path: `${LEGS}/image.jpg`,
            size: 2048,
          },
          muscle_groups: ["quadriceps", "glutes"],
        },
      ],
      ok: true,
    });
  });

  it("loads no Covers when the covers folder doesn't exist", async () => {
    expect(await loadCovers(join(dir, "covers"))).toEqual({
      covers: [],
      ok: true,
    });
  });

  it("reports a covers file instead of a folder", async () => {
    await writeFile(join(dir, "covers"), "");

    const result = await loadCovers(join(dir, "covers"));

    expect(result).toEqual({
      ok: false,
      problems: [
        expect.objectContaining({
          message: expect.stringContaining("covers/ folder"),
        }),
      ],
    });
  });

  it.each([
    ["an uppercase id", CHEST.toUpperCase()],
    ["a non-uuid id", "chest-cover"],
    ["a uuid without hyphens", CHEST.replaceAll("-", "")],
  ])("rejects %s", async (_, id) => {
    await writeFiles(dir, prefix(id, coverFiles(["chest"])));

    expect(await problems()).toEqual([
      {
        cover: id,
        file: id,
        message: expect.stringContaining("lowercase uuid"),
      },
    ]);
  });

  it.each([
    [["neck"], "unknown muscle group"],
    [[], "muscle_groups"],
    [["chest", "chest"], "must not repeat"],
  ])("rejects muscle groups %j", async (groups, message) => {
    await writeFiles(dir, prefix(CHEST, coverFiles(groups)));

    expect(await problems()).toEqual([
      {
        cover: CHEST,
        file: `${CHEST}/metadata.json`,
        message: expect.stringContaining(message),
      },
    ]);
  });

  it("rejects unknown metadata fields", async () => {
    await writeFiles(dir, {
      ...prefix(CHEST, coverFiles(["chest"])),
      [`${CHEST}/metadata.json`]: JSON.stringify({
        alt: "A bench",
        muscle_groups: ["chest"],
      }),
    });

    expect(await problems()).toEqual([
      expect.objectContaining({
        file: `${CHEST}/metadata.json`,
        message: expect.stringContaining("alt"),
      }),
    ]);
  });

  it.each([
    ["image.mp4", "unsupported media type"],
    ["image.jpeg", "unsupported media type"],
    ["Image.JPG", "lowercase"],
  ])("rejects the image %s", async (file, message) => {
    await writeFiles(dir, {
      [`${CHEST}/metadata.json`]: JSON.stringify({ muscle_groups: ["chest"] }),
      [`${CHEST}/${file}`]: lfsPointer(fakeOid("d"), 2048),
    });

    expect(await problems()).toEqual([
      {
        cover: CHEST,
        file: `${CHEST}/${file}`,
        message: expect.stringContaining(message),
      },
    ]);
  });

  it("requires an image, and only one", async () => {
    await writeFiles(dir, {
      [`${CHEST}/metadata.json`]: JSON.stringify({ muscle_groups: ["chest"] }),
      ...prefix(LEGS, coverFiles(["glutes"])),
      [`${LEGS}/image.png`]: lfsPointer(fakeOid("e"), 2048),
    });

    expect(await problems()).toEqual([
      {
        cover: CHEST,
        file: `${CHEST}/image.{jpg,png,webp}`,
        message: "missing image",
      },
      expect.objectContaining({
        cover: LEGS,
        file: `${LEGS}/image.jpg`,
        message: "more than one image",
      }),
      expect.objectContaining({
        cover: LEGS,
        file: `${LEGS}/image.png`,
        message: "more than one image",
      }),
    ]);
  });

  it("rejects an image over 25 MB", async () => {
    await writeFiles(dir, {
      ...prefix(CHEST, coverFiles(["chest"])),
      [`${CHEST}/image.jpg`]: lfsPointer(fakeOid("d"), 25_000_001),
    });

    expect(await problems()).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("25 MB"),
      }),
    ]);
  });

  it("requires the image to be an LFS pointer in CI", async () => {
    await writeFiles(dir, {
      ...prefix(CHEST, coverFiles(["chest"])),
      [`${CHEST}/image.jpg`]: "not an image",
    });

    expect(await problems()).toEqual([
      expect.objectContaining({ file: `${CHEST}/image.jpg` }),
    ]);
  });

  it("rejects unexpected files and anything that isn't a Cover folder", async () => {
    await writeFiles(dir, {
      ...prefix(CHEST, coverFiles(["chest"])),
      [`${CHEST}/master.jpg`]: lfsPointer(fakeOid("e"), 2048),
      ".DS_Store": "",
      "notes.txt": "hi",
    });

    expect(await problems()).toEqual([
      {
        cover: CHEST,
        file: `${CHEST}/master.jpg`,
        message: expect.stringContaining("unexpected file"),
      },
      {
        cover: "notes.txt",
        file: "notes.txt",
        message: "not a Cover folder",
      },
    ]);
  });
});
