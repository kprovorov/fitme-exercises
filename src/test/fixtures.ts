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

/** Puts an Exercise folder's files under `<slug>/`. */
export const prefix = (
  slug: string,
  files: Record<string, string | Uint8Array>
) =>
  Object.fromEntries(
    Object.entries(files).map(([path, content]) => [`${slug}/${path}`, content])
  );

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

/** A real, decodable 1×1 PNG. */
export const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);

/** An ISO base media box: 4-byte size, 4-byte type, then content. */
export const box = (type: string, ...content: Buffer[]) => {
  const body = Buffer.concat(content);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
};

/** A minimal MP4: `ftyp` with the given brands, one track with the given handler and sample count. */
export const mp4 = ({
  brands = ["isom", "isom", "mp42"],
  handler = "vide",
  samples = 10,
  describe = true,
  sizeEntries = samples,
}: {
  brands?: string[];
  handler?: string;
  samples?: number;
  /** Include the video sample entry that `stsd` declares (it always declares one). */
  describe?: boolean;
  /** How many entries the sample size table actually holds. */
  sizeEntries?: number;
} = {}) => {
  const [major, ...compatible] = brands;
  const minorVersion = Buffer.alloc(4);
  const hdlr = Buffer.alloc(24);
  hdlr.write(handler, 8, "latin1");
  const visualSampleEntry = Buffer.alloc(78);
  visualSampleEntry.writeUInt16BE(64, 24);
  visualSampleEntry.writeUInt16BE(64, 26);
  const stsdHeader = Buffer.alloc(8);
  stsdHeader.writeUInt32BE(1, 4);
  const stsd = describe
    ? Buffer.concat([stsdHeader, box("avc1", visualSampleEntry)])
    : stsdHeader;
  // sample_size 0: a table of one 4-byte size per sample follows.
  const stsz = Buffer.alloc(12 + 4 * sizeEntries);
  stsz.writeUInt32BE(samples, 8);
  for (let i = 0; i < sizeEntries; i += 1) {
    stsz.writeUInt32BE(100, 12 + 4 * i);
  }
  return Buffer.concat([
    box(
      "ftyp",
      Buffer.from(major, "latin1"),
      minorVersion,
      ...compatible.map((brand) => Buffer.from(brand, "latin1"))
    ),
    box(
      "moov",
      box(
        "trak",
        box(
          "mdia",
          box("hdlr", hdlr),
          box("minf", box("stbl", box("stsd", stsd), box("stsz", stsz)))
        )
      )
    ),
    box("mdat", Buffer.alloc(16)),
  ]);
};
