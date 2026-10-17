import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exerciseFiles,
  fakeOid,
  lfsPointer,
  makeLibraryDir,
  pngHeader,
  writeFiles,
} from "../test/fixtures";
import { loadLibrary } from "./load";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeLibraryDir());
});

afterEach(async () => {
  await cleanup();
});

describe("loadLibrary", () => {
  it("returns the validated Exercise Library", async () => {
    await writeFiles(dir, {
      ...prefix("squat", exerciseFiles("Squat")),
      ...prefix("bench-press", exerciseFiles("Bench Press")),
    });

    const result = await loadLibrary(dir);

    expect(result).toEqual({
      library: {
        exercises: [
          {
            locales: {
              en: {
                description: "Bench Press is a compound pushing movement.\n",
                instructions: "1. Lie on the bench.\n2. Press.\n",
                name: "Bench Press",
              },
            },
            muscle_groups: ["chest", "triceps"],
            slug: "bench-press",
            thumbnail: {
              contentType: "image/png",
              extension: "png",
              oid: fakeOid("a"),
              path: "bench-press/thumbnail.png",
              size: 2048,
            },
            video: {
              contentType: "video/mp4",
              extension: "mp4",
              oid: fakeOid("b"),
              path: "bench-press/video.mp4",
              size: 4096,
            },
          },
          expect.objectContaining({ slug: "squat" }),
        ],
      },
      ok: true,
    });
  });

  it.each([
    "Bench-Press",
    "bench_press",
    "bench--press",
    "-bench-press",
    "bench-press-",
    "bench press",
  ])("reports the invalid Exercise slug %j", async (slug) => {
    await writeFiles(dir, prefix(slug, exerciseFiles()));

    expect(await problems()).toEqual([
      {
        exercise: slug,
        file: slug,
        message: expect.stringContaining("invalid Exercise slug"),
      },
    ]);
  });

  it("reports schema violations in metadata files", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/en/metadata.json": JSON.stringify({ name: " " }),
      "bench-press/metadata.json": JSON.stringify({
        equipment: "barbell",
        muscle_groups: [],
      }),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/metadata.json",
        message: expect.stringContaining("muscle_groups"),
      },
      {
        exercise: "bench-press",
        file: "bench-press/metadata.json",
        message: expect.stringContaining("equipment"),
      },
      {
        exercise: "bench-press",
        file: "bench-press/en/metadata.json",
        message: expect.stringContaining("name"),
      },
    ]);
  });

  it("reports invalid JSON", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/metadata.json": "{ muscle_groups: ",
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/metadata.json",
        message: "invalid JSON",
      },
    ]);
  });

  it("reports an unknown muscle group", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/metadata.json": JSON.stringify({
        muscle_groups: ["chest", "neck"],
      }),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/metadata.json",
        message: expect.stringContaining('unknown muscle group "neck"'),
      },
    ]);
  });

  it("reports a repeated muscle group", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/metadata.json": JSON.stringify({
        muscle_groups: ["chest", "chest"],
      }),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/metadata.json",
        message: "muscle_groups: muscle groups must not repeat",
      },
    ]);
  });

  it.each([
    "metadata.json",
    "en/metadata.json",
    "en/description.md",
    "en/instructions.md",
  ])("reports a missing %s", async (file) => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press", file));

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: `bench-press/${file}`,
        message: "missing file",
      },
    ]);
  });

  it("reports an empty markdown file", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/en/description.md": "\n",
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/en/description.md",
        message: "file is empty",
      },
    ]);
  });

  it("reports a missing thumbnail and video", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press/thumbnail.png"));
    await rm(join(dir, "bench-press/video.mp4"));

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.{jpg,png,webp}",
        message: "missing thumbnail",
      },
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message: "missing video",
      },
    ]);
  });

  it("reports more than one thumbnail", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.jpg": lfsPointer(fakeOid("c"), 100),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.jpg",
        message: "more than one thumbnail",
      },
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.png",
        message: "more than one thumbnail",
      },
    ]);
  });

  it("reports unsupported media types", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press/thumbnail.png"));
    await rm(join(dir, "bench-press/video.mp4"));
    await writeFiles(dir, {
      "bench-press/thumbnail.gif": lfsPointer(fakeOid("a"), 100),
      "bench-press/video.mov": lfsPointer(fakeOid("b"), 100),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.gif",
        message: expect.stringContaining('unsupported media type ".gif"'),
      },
      {
        exercise: "bench-press",
        file: "bench-press/video.mov",
        message: expect.stringContaining('unsupported media type ".mov"'),
      },
    ]);
  });

  it("reports oversized media from LFS pointer sizes", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.png": lfsPointer(fakeOid("a"), 25_000_001),
      "bench-press/video.mp4": lfsPointer(fakeOid("b"), 20_000_001),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.png",
        message: "thumbnail is 25 MB, over the 25 MB limit",
      },
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message: "video is 20 MB, over the 20 MB limit",
      },
    ]);
  });

  it("accepts media exactly at the size limits", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.png": lfsPointer(fakeOid("a"), 25_000_000),
      "bench-press/video.mp4": lfsPointer(fakeOid("b"), 20_000_000),
    });

    expect((await loadLibrary(dir)).ok).toBe(true);
  });

  it("reports a thumbnail over 50 megapixels when its content is present", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.png": pngHeader(10_000, 5001),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.png",
        message:
          "thumbnail is 10000×5001 (50 megapixels), over the 50 megapixels limit",
      },
    ]);
  });

  it("reports a thumbnail whose content doesn't match its extension", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press/thumbnail.png"));
    await writeFiles(dir, { "bench-press/thumbnail.webp": pngHeader(10, 10) });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.webp",
        message: "content is png but the extension is .webp",
      },
    ]);
  });

  it("reports a malformed LFS pointer", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/video.mp4":
        "version https://git-lfs.github.com/spec/v1\noid sha256:nope\n",
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message: "malformed Git LFS pointer",
      },
    ]);
  });

  it("takes the oid of downloaded LFS content from its sha256", async () => {
    const png = pngHeader(640, 480);
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.png": png,
    });

    const result = await loadLibrary(dir);

    expect(result.ok && result.library.exercises[0].thumbnail).toEqual({
      contentType: "image/png",
      extension: "png",
      oid: createHash("sha256").update(png).digest("hex"),
      path: "bench-press/thumbnail.png",
      size: png.length,
    });
  });

  it("reports files that aren't Exercise folders and ignores dotfiles", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      ".DS_Store": "",
      "README.md": "# Exercises\n",
    });

    expect(await problems()).toEqual([
      {
        exercise: "README.md",
        file: "README.md",
        message: "not an Exercise folder",
      },
    ]);
  });

  it("lists every problem across Exercises", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      ...prefix("squat", exerciseFiles("Squat")),
      ...prefix("deadlift", exerciseFiles("Deadlift")),
      "bench-press/metadata.json": JSON.stringify({ muscle_groups: ["neck"] }),
      "squat/video.mp4": lfsPointer(fakeOid("b"), 30_000_000),
    });

    expect(await problems()).toEqual([
      expect.objectContaining({
        exercise: "bench-press",
        file: "bench-press/metadata.json",
      }),
      expect.objectContaining({ exercise: "squat", file: "squat/video.mp4" }),
    ]);
  });
});

async function problems() {
  const result = await loadLibrary(dir);
  if (result.ok) {
    throw new Error("expected problems, got a valid Exercise Library");
  }
  return result.problems;
}

function prefix(slug: string, files: Record<string, string | Uint8Array>) {
  return Object.fromEntries(
    Object.entries(files).map(([path, content]) => [`${slug}/${path}`, content])
  );
}
