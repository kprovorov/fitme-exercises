import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exerciseFiles,
  fakeOid,
  lfsPointer,
  makeLibraryDir,
  mp4,
  pngHeader,
  prefix,
  TINY_PNG,
  writeFiles,
} from "../test/fixtures";
import { loadLibrary } from "./load";

// sha256 of TINY_PNG, computed independently with sha256sum.
const TINY_PNG_SHA256 =
  "63ef318d96b5d0d0ceba6e04a4e622b1158335cdc67c49e27839132c6f655058";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeLibraryDir());
});

afterEach(async () => {
  await cleanup();
});

describe("loadLibrary", () => {
  it("validates an optional original without adding it to served media", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/original.mp4": lfsPointer(fakeOid("c"), 25_000_000),
    });

    const result = await loadLibrary(dir, { requireLfsPointers: true });
    expect(result.ok).toBe(true);
    expect(result.ok && result.library.exercises[0]).not.toHaveProperty(
      "original"
    );
  });

  it.each([
    ["original.mp4", "broken", "MP4"],
    ["original.mp4", lfsPointer(fakeOid("c"), 100_000_001), "100 MB"],
    ["original.mov", lfsPointer(fakeOid("c"), 100), "unsupported media type"],
    ["Original.MP4", lfsPointer(fakeOid("c"), 100), "lowercase"],
  ])(
    "rejects an invalid archival video %s (%s)",
    async (file, bytes, message) => {
      await writeFiles(dir, {
        ...prefix("bench-press", exerciseFiles()),
        [`bench-press/${file}`]: bytes,
      });

      expect(await problems()).toEqual([
        expect.objectContaining({
          file: `bench-press/${file}`,
          message: expect.stringContaining(message),
        }),
      ]);
    }
  );

  it("requires originals to be LFS pointers in CI", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/original.mp4": mp4(),
    });

    expect((await loadLibrary(dir)).ok).toBe(true);
    const result = await loadLibrary(dir, { requireLfsPointers: true });
    expect(result.ok ? [] : result.problems).toEqual([
      expect.objectContaining({
        file: "bench-press/original.mp4",
        message: expect.stringContaining("not a Git LFS pointer"),
      }),
    ]);
  });

  it("rejects symlinked originals", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await symlink("video.mp4", join(dir, "bench-press/original.mp4"));

    expect(await problems()).toEqual([
      expect.objectContaining({
        file: "bench-press/original.mp4",
        message: expect.stringContaining("symlinks aren't allowed"),
      }),
    ]);
  });

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
        message:
          "thumbnail is 25,000,001 bytes, over the 25 MB (25,000,000 bytes) limit",
      },
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message:
          "video is 20,000,001 bytes, over the 20 MB (20,000,000 bytes) limit",
      },
    ]);
  });

  it("reports oversized downloaded content", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/video.mp4": Buffer.alloc(20_000_001),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message:
          "video is 20,000,001 bytes, over the 20 MB (20,000,000 bytes) limit",
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
          "thumbnail is 10000×5001 (50,010,000 pixels), over the 50 megapixel (50,000,000 pixels) limit",
      },
    ]);
  });

  it("reports a thumbnail whose content doesn't match its extension", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press/thumbnail.png"));
    await writeFiles(dir, { "bench-press/thumbnail.webp": TINY_PNG });

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
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.png": TINY_PNG,
      "bench-press/video.mp4": mp4(),
    });

    const result = await loadLibrary(dir);

    expect(result.ok && result.library.exercises[0].thumbnail).toEqual({
      contentType: "image/png",
      extension: "png",
      oid: TINY_PNG_SHA256,
      path: "bench-press/thumbnail.png",
      size: TINY_PNG.length,
    });
  });

  it("reports downloaded video content that isn't an MP4", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/video.mp4": "not a video",
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message: "not a valid MP4: malformed box structure",
      },
    ]);
  });

  it.each([
    [
      "a QuickTime movie",
      mp4({ brands: ["qt  ", "qt  "] }),
      "not a valid MP4: ftyp has no MP4 brand",
    ],
    [
      "an audio-only MP4",
      mp4({ handler: "soun" }),
      "not a valid MP4 video: no video track",
    ],
    [
      "an MP4 whose video track has no samples",
      mp4({ samples: 0 }),
      "not a valid MP4 video: no video track",
    ],
    [
      "an MP4 whose video track has no sample description",
      mp4({ describe: false }),
      "not a valid MP4 video: no video track",
    ],
    [
      "an MP4 whose sample size table is truncated",
      mp4({ sizeEntries: 3 }),
      "not a valid MP4 video: no video track",
    ],
    [
      "a truncated MP4",
      mp4().subarray(0, -4),
      "not a valid MP4: malformed box structure",
    ],
    [
      "a file that is only a ftyp marker",
      Buffer.from("\0\0\0\x08ftyp", "latin1"),
      "not a valid MP4: no ftyp box",
    ],
  ])("reports %s as the video", async (_, video, message) => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/video.mp4": video,
    });

    expect(await problems()).toEqual([
      { exercise: "bench-press", file: "bench-press/video.mp4", message },
    ]);
  });

  it.each(["en/metadata.json", "en/description.md"])(
    "reports invalid UTF-8 in %s",
    async (file) => {
      await writeFiles(dir, {
        ...prefix("bench-press", exerciseFiles()),
        [`bench-press/${file}`]: Buffer.concat([
          Buffer.from('{ "name": "Bench '),
          Buffer.from([0xff]),
          Buffer.from('" }'),
        ]),
      });

      expect(await problems()).toEqual([
        {
          exercise: "bench-press",
          file: `bench-press/${file}`,
          message: "not valid UTF-8",
        },
      ]);
    }
  );

  it("reports symlinked media, metadata and locale folders", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      ...prefix("squat", exerciseFiles("Squat")),
    });
    await Promise.all(
      [
        ["bench-press/video.mp4", "../squat/video.mp4"],
        ["bench-press/metadata.json", "../squat/metadata.json"],
        ["bench-press/en", "../squat/en"],
      ].map(async ([link, target]) => {
        await rm(join(dir, link), { recursive: true });
        await symlink(target, join(dir, link));
      })
    );

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/metadata.json",
        message: "symlinks aren't allowed: commit the file itself",
      },
      {
        exercise: "bench-press",
        file: "bench-press/en",
        message: "symlinks aren't allowed: commit the folder itself",
      },
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message: "symlinks aren't allowed: commit the file itself",
      },
    ]);
  });

  it("reports unexpected files in Exercise and locale folders", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/.DS_Store": "",
      "bench-press/en/notes.md": "draft\n",
      "bench-press/source.mp4": "raw video committed without Git LFS",
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/source.mp4",
        message: expect.stringContaining("unexpected file"),
      },
      {
        exercise: "bench-press",
        file: "bench-press/en/notes.md",
        message: expect.stringContaining("unexpected file"),
      },
    ]);
  });

  it("reports a corrupt thumbnail whose header is intact", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/thumbnail.png": pngHeader(64, 64),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.png",
        message: "image can't be decoded (corrupt or truncated)",
      },
    ]);
  });

  it("reports a file where the locale folder belongs", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press/en"), { recursive: true });
    await writeFiles(dir, { "bench-press/en": "" });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/en",
        message: "expected a locale folder, found a file",
      },
    ]);
  });

  it("requires LFS pointers when asked to", async () => {
    await writeFiles(dir, {
      ...prefix("bench-press", exerciseFiles()),
      "bench-press/video.mp4": mp4(),
    });

    expect((await loadLibrary(dir)).ok).toBe(true);
    const result = await loadLibrary(dir, { requireLfsPointers: true });
    expect(result.ok ? [] : result.problems).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/video.mp4",
        message: expect.stringContaining("committed without Git LFS"),
      },
    ]);
  });

  it("reports media file names that aren't lowercase", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press/video.mp4"));
    await writeFiles(dir, {
      "bench-press/Video.MP4": lfsPointer(fakeOid("b"), 100),
    });

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/Video.MP4",
        message: "media file names are lowercase: rename to video.mp4",
      },
    ]);
  });

  it("reports a folder where a file belongs", async () => {
    await writeFiles(dir, prefix("bench-press", exerciseFiles()));
    await rm(join(dir, "bench-press/thumbnail.png"));
    await rm(join(dir, "bench-press/en/description.md"));
    await mkdir(join(dir, "bench-press/thumbnail.png"));
    await mkdir(join(dir, "bench-press/en/description.md"));

    expect(await problems()).toEqual([
      {
        exercise: "bench-press",
        file: "bench-press/en/description.md",
        message: "expected a file, found a folder",
      },
      {
        exercise: "bench-press",
        file: "bench-press/thumbnail.png",
        message: "expected a file, found a folder",
      },
    ]);
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
