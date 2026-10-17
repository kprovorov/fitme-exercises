import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { z } from "zod";
import { readMedia } from "./media";
import type { MuscleGroup } from "./muscle-groups";
import { ExerciseMetadata, LocaleMetadata } from "./schema";
import type {
  Exercise,
  ExerciseText,
  LoadResult,
  Locale,
  Media,
  Problem,
} from "./types";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const MB = 1000 * 1000;

interface MediaKind {
  contentTypes: Record<string, string>;
  maxPixels?: number;
  maxSize: number;
  name: "thumbnail" | "video";
}

const THUMBNAIL: MediaKind = {
  contentTypes: { jpg: "image/jpeg", png: "image/png", webp: "image/webp" },
  maxPixels: 50_000_000,
  maxSize: 25 * MB,
  name: "thumbnail",
};

const VIDEO: MediaKind = {
  contentTypes: { mp4: "video/mp4" },
  maxSize: 20 * MB,
  name: "video",
};

/**
 * Reads every Exercise folder under `root` and returns either the validated
 * Exercise Library or every problem found, each naming the Exercise and file.
 */
export const loadLibrary = async (root: string): Promise<LoadResult> => {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name));

  const loaded = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? loadExercise(root, entry.name)
        : {
            problems: [
              {
                exercise: entry.name,
                file: entry.name,
                message: "not an Exercise folder",
              },
            ],
          }
    )
  );

  const problems = loaded.flatMap((result) => result.problems);
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  const exercises = loaded.flatMap((result) =>
    "exercise" in result && result.exercise ? [result.exercise] : []
  );
  return { library: { exercises }, ok: true };
};

const loadExercise = async (
  root: string,
  slug: string
): Promise<{ exercise?: Exercise; problems: Problem[] }> => {
  const problems: Problem[] = [];
  const report = (file: string, message: string) =>
    problems.push({ exercise: slug, file: `${slug}/${file}`, message });

  if (!SLUG_PATTERN.test(slug)) {
    problems.push({
      exercise: slug,
      file: slug,
      message: `invalid Exercise slug: must match ${SLUG_PATTERN.source} (lowercase letters and digits, words joined by single hyphens)`,
    });
  }

  const dir = join(root, slug);
  const metadata = await readJson(
    dir,
    "metadata.json",
    ExerciseMetadata,
    report
  );
  const en = await readLocale(dir, "en", report);
  const files = await readdir(dir);
  const thumbnail = await readMediaKind(dir, slug, files, THUMBNAIL, report);
  const video = await readMediaKind(dir, slug, files, VIDEO, report);

  if (problems.length > 0 || !(metadata && en && thumbnail && video)) {
    return { problems };
  }
  const exercise: Exercise = {
    locales: { en },
    muscle_groups: metadata.muscle_groups as MuscleGroup[],
    slug,
    thumbnail,
    video,
  };
  return { exercise, problems };
};

type Report = (file: string, message: string) => void;

const readText = async (
  dir: string,
  file: string,
  report: Report
): Promise<string | undefined> => {
  try {
    return await readFile(join(dir, file), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      report(file, "missing file");
      return;
    }
    throw error;
  }
};

const readJson = async <T extends z.ZodTypeAny>(
  dir: string,
  file: string,
  schema: T,
  report: Report
): Promise<z.infer<T> | undefined> => {
  const text = await readText(dir, file, report);
  if (text === undefined) {
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    report(file, "invalid JSON");
    return;
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const at = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      report(file, `${at}${issue.message}`);
    }
    return;
  }
  return parsed.data;
};

const readLocale = async (
  dir: string,
  locale: Locale,
  report: Report
): Promise<ExerciseText | undefined> => {
  const metadata = await readJson(
    dir,
    `${locale}/metadata.json`,
    LocaleMetadata,
    report
  );
  const description = await readMarkdown(
    dir,
    `${locale}/description.md`,
    report
  );
  const instructions = await readMarkdown(
    dir,
    `${locale}/instructions.md`,
    report
  );
  if (!(metadata && description && instructions)) {
    return;
  }
  return { description, instructions, name: metadata.name };
};

const readMarkdown = async (dir: string, file: string, report: Report) => {
  const text = await readText(dir, file, report);
  if (text !== undefined && text.trim() === "") {
    report(file, "file is empty");
    return;
  }
  return text;
};

const readMediaKind = async (
  dir: string,
  slug: string,
  files: string[],
  kind: MediaKind,
  report: Report
): Promise<Media | undefined> => {
  const allowed = Object.keys(kind.contentTypes);
  const candidates = files.filter(
    (name) => name.slice(0, name.length - extname(name).length) === kind.name
  );

  if (candidates.length === 0) {
    report(
      `${kind.name}.${allowed.length > 1 ? `{${allowed.join(",")}}` : allowed[0]}`,
      `missing ${kind.name}`
    );
    return;
  }
  if (candidates.length > 1) {
    for (const candidate of candidates) {
      report(candidate, `more than one ${kind.name}`);
    }
    return;
  }

  const [file] = candidates;
  const extension = extname(file).slice(1);
  const contentType = kind.contentTypes[extension];
  if (!contentType) {
    report(
      file,
      `unsupported media type ".${extension}" for ${kind.name} (allowed: ${allowed.join(", ")})`
    );
    return;
  }

  const read = await readMedia(join(dir, file), {
    image: kind.maxPixels !== undefined,
  });
  if (!read.ok) {
    report(file, read.message);
    return;
  }
  const { oid, size, dimensions, imageType } = read.media;

  let valid = true;
  if (size > kind.maxSize) {
    report(
      file,
      `${kind.name} is ${formatMB(size)}, over the ${formatMB(kind.maxSize)} limit`
    );
    valid = false;
  }
  if (imageType && imageType !== extension) {
    report(file, `content is ${imageType} but the extension is .${extension}`);
    valid = false;
  }
  if (dimensions && kind.maxPixels !== undefined) {
    const pixels = dimensions.width * dimensions.height;
    if (pixels > kind.maxPixels) {
      report(
        file,
        `${kind.name} is ${dimensions.width}×${dimensions.height} (${formatMP(pixels)}), over the ${formatMP(kind.maxPixels)} limit`
      );
      valid = false;
    }
  }
  if (!valid) {
    return;
  }

  return { contentType, extension, oid, path: `${slug}/${file}`, size };
};

const formatMB = (bytes: number) => `${Number((bytes / MB).toFixed(1))} MB`;

const formatMP = (pixels: number) =>
  `${Number((pixels / 1_000_000).toFixed(1))} megapixels`;
