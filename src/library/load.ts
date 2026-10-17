import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { z } from "zod";
import { type MediaFormat, readMedia } from "./media";
import { ExerciseMetadata, LocaleMetadata } from "./schema";
import type {
  Exercise,
  ExerciseText,
  LoadResult,
  Locale,
  Media,
  Problem,
} from "./types";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MB = 1000 * 1000;
const MEGAPIXEL = 1000 * 1000;

interface MediaKind {
  contentTypes: Record<string, string>;
  format: MediaFormat;
  maxPixels?: number;
  maxSize: number;
  name: "thumbnail" | "video";
}

const THUMBNAIL: MediaKind = {
  contentTypes: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" },
  format: "image",
  maxPixels: 50 * MEGAPIXEL,
  maxSize: 25 * MB,
  name: "thumbnail",
};

const VIDEO: MediaKind = {
  contentTypes: { mp4: "video/mp4" },
  format: "mp4",
  maxSize: 20 * MB,
  name: "video",
};

export interface LoadOptions {
  /**
   * Require every media file to be a Git LFS pointer. Set it where LFS content
   * is never downloaded (CI): a file that isn't a pointer there was committed
   * without Git LFS.
   */
  requireLfsPointers?: boolean;
}

/** One Exercise folder being read, and where its problems go. */
interface Folder {
  dir: string;
  options: LoadOptions;
  /** Reports a problem with `file` (relative to the folder; "" is the folder itself). */
  report: (file: string, message: string) => void;
  slug: string;
}

/**
 * Reads every Exercise folder under `root` and returns either the validated
 * Exercise Library or every problem found, each naming the Exercise and file.
 */
export const loadLibrary = async (
  root: string,
  options: LoadOptions = {}
): Promise<LoadResult> => {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  // One Exercise at a time: with LFS content downloaded, each holds up to
  // 45 MB of media in memory.
  const loaded: { exercise?: Exercise; problems: Problem[] }[] = [];
  for (const entry of entries) {
    loaded.push(
      entry.isDirectory()
        ? // biome-ignore lint/performance/noAwaitInLoops: bounds memory, see above
          await loadExercise(root, entry.name, options)
        : {
            problems: [
              {
                exercise: entry.name,
                file: entry.name,
                message: "not an Exercise folder",
              },
            ],
          }
    );
  }

  const problems = loaded.flatMap((result) => result.problems);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  const exercises = loaded.flatMap((result) =>
    result.exercise ? [result.exercise] : []
  );
  return { library: { exercises }, ok: true };
};

const loadExercise = async (
  root: string,
  slug: string,
  options: LoadOptions
): Promise<{ exercise?: Exercise; problems: Problem[] }> => {
  const problems: Problem[] = [];
  const folder: Folder = {
    dir: join(root, slug),
    options,
    report: (file, message) =>
      problems.push({
        exercise: slug,
        file: file ? `${slug}/${file}` : slug,
        message,
      }),
    slug,
  };

  if (!SLUG_PATTERN.test(slug)) {
    folder.report(
      "",
      `invalid Exercise slug: must match ${SLUG_PATTERN.source} (lowercase letters and digits, words joined by single hyphens)`
    );
  }

  const metadata = await readJson(folder, "metadata.json", ExerciseMetadata);
  const en = await readLocale(folder, "en");
  const files = await readdir(folder.dir);
  const thumbnail = await readMediaKind(folder, files, THUMBNAIL);
  const video = await readMediaKind(folder, files, VIDEO);

  if (problems.length > 0 || !(metadata && en && thumbnail && video)) {
    return { problems };
  }
  const exercise: Exercise = {
    locales: { en },
    muscle_groups: metadata.muscle_groups,
    slug,
    thumbnail,
    video,
  };
  return { exercise, problems };
};

/** Reads a file, reporting it as missing (or as a folder) instead of throwing. */
const readFolderFile = async (
  folder: Folder,
  file: string
): Promise<Buffer | undefined> => {
  try {
    return await readFile(join(folder.dir, file));
  } catch (error) {
    const { code } = error as NodeJS.ErrnoException;
    if (code === "ENOENT") {
      folder.report(file, "missing file");
      return;
    }
    if (code === "ENOTDIR") {
      folder.report(file, "missing file: a folder on its path is a file");
      return;
    }
    if (code === "EISDIR") {
      folder.report(file, "expected a file, found a folder");
      return;
    }
    throw error;
  }
};

const readText = async (folder: Folder, file: string) =>
  (await readFolderFile(folder, file))?.toString("utf8");

const readJson = async <T extends z.ZodType>(
  folder: Folder,
  file: string,
  schema: T
): Promise<z.infer<T> | undefined> => {
  const text = await readText(folder, file);
  if (text === undefined) {
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    folder.report(file, "invalid JSON");
    return;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      folder.report(file, `${at}${issue.message}`);
    }
    return;
  }
  return parsed.data;
};

const readLocale = async (
  folder: Folder,
  locale: Locale
): Promise<ExerciseText | undefined> => {
  const metadata = await readJson(
    folder,
    `${locale}/metadata.json`,
    LocaleMetadata
  );
  const description = await readMarkdown(folder, `${locale}/description.md`);
  const instructions = await readMarkdown(folder, `${locale}/instructions.md`);
  if (!(metadata && description && instructions)) {
    return;
  }
  return { description, instructions, name: metadata.name };
};

const readMarkdown = async (folder: Folder, file: string) => {
  const text = await readText(folder, file);
  if (text !== undefined && text.trim() === "") {
    folder.report(file, "file is empty");
    return;
  }
  return text;
};

const readMediaKind = async (
  folder: Folder,
  files: string[],
  kind: MediaKind
): Promise<Media | undefined> => {
  const allowed = Object.keys(kind.contentTypes);
  const candidates = files.filter(
    (name) =>
      name.slice(0, name.length - extname(name).length).toLowerCase() ===
      kind.name
  );

  if (candidates.length === 0) {
    folder.report(
      `${kind.name}.${allowed.length > 1 ? `{${allowed.join(",")}}` : allowed[0]}`,
      `missing ${kind.name}`
    );
    return;
  }
  if (candidates.length > 1) {
    for (const candidate of candidates) {
      folder.report(candidate, `more than one ${kind.name}`);
    }
    return;
  }

  const [file] = candidates;
  const extension = extname(file).slice(1).toLowerCase();
  const contentType = kind.contentTypes[extension];
  if (!contentType) {
    folder.report(
      file,
      `unsupported media type ".${extension}" for ${kind.name} (allowed: ${allowed.join(", ")})`
    );
    return;
  }
  const expectedName = `${kind.name}.${extension}`;
  if (file !== expectedName) {
    folder.report(
      file,
      `media file names are lowercase: rename to ${expectedName}`
    );
    return;
  }

  const bytes = await readFolderFile(folder, file);
  if (!bytes) {
    return;
  }
  const read = await readMedia(bytes, kind.format, kind.maxPixels);
  if (!read.ok) {
    folder.report(file, read.message);
    return;
  }
  if (folder.options.requireLfsPointers && !read.pointer) {
    folder.report(
      file,
      "committed without Git LFS: run `git lfs install`, then remove and re-add the file"
    );
    return;
  }
  const { oid, size, dimensions, imageType } = read.media;

  let valid = true;
  if (size > kind.maxSize) {
    folder.report(
      file,
      `${kind.name} is ${formatCount(size)} bytes, over the ${kind.maxSize / MB} MB (${formatCount(kind.maxSize)} bytes) limit`
    );
    valid = false;
  }
  if (imageType && imageType !== extension) {
    folder.report(
      file,
      `content is ${imageType} but the extension is .${extension}`
    );
    valid = false;
  }
  if (dimensions && kind.maxPixels !== undefined) {
    const pixels = dimensions.width * dimensions.height;
    if (pixels > kind.maxPixels) {
      folder.report(
        file,
        `${kind.name} is ${dimensions.width}×${dimensions.height} (${formatCount(pixels)} pixels), over the ${kind.maxPixels / MEGAPIXEL} megapixel (${formatCount(kind.maxPixels)} pixels) limit`
      );
      valid = false;
    }
  }
  if (!valid) {
    return;
  }

  return {
    contentType,
    extension,
    oid,
    path: `${folder.slug}/${file}`,
    size,
  };
};

const formatCount = (count: number) => count.toLocaleString("en-US");
