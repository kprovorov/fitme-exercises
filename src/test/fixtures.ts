import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const lfsPointer = (oid: string, size: number) =>
  `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

export const fakeOid = (char: string) => char.repeat(64);

/** A valid Exercise folder as a map of relative path → file content. */
export const exerciseFiles = (
  name = "Bench Press"
): Record<string, string | Uint8Array> => ({
  "en/description.md": `${name} is a compound pushing movement.\n`,
  "en/instructions.md": "1. Lie on the bench.\n2. Press.\n",
  "en/metadata.json": JSON.stringify({ name }),
  "metadata.json": JSON.stringify({ muscle_groups: ["chest", "triceps"] }),
  "thumbnail.png": lfsPointer(fakeOid("a"), 2048),
  "video.mp4": lfsPointer(fakeOid("b"), 4096),
});

export const writeFiles = async (
  root: string,
  files: Record<string, string | Uint8Array>
) => {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const full = join(root, path);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
    })
  );
};

export const makeLibraryDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "exercise-library-"));
  return { cleanup: () => rm(dir, { force: true, recursive: true }), dir };
};

/** The first bytes of a PNG (signature + IHDR): enough to read its dimensions. */
export const pngHeader = (width: number, height: number) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt8(8, 24);
  bytes.writeUInt8(6, 25);
  return bytes;
};
