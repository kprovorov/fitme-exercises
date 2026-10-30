import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PutObjectCommand,
  paginateListObjectsV2,
  S3Client,
} from "@aws-sdk/client-s3";
import { put } from "@vercel/blob";
import { loadContent } from "./library/content";
import {
  coverMedia,
  exerciseMedia,
  type PlannedUpload,
  planUploads,
} from "./library/upload-plan";
import { reportProblems } from "./report";

/**
 * The release steps the workflow (`.github/workflows/release.yml`) runs, in
 * order, on every merge to `main`:
 *
 * - `pnpm release plan`: lists the bucket and writes the upload plan (the media
 *   objects missing from it) to `dist/upload-plan.json`. Reads only Git LFS
 *   pointers. In GitHub Actions it also outputs `count` and `include`, the
 *   planned files for `git lfs pull --include`.
 * - `pnpm release upload`: uploads the planned objects from their downloaded
 *   LFS content, checking each file's sha256 against its oid first.
 * - `pnpm release publish`: uploads `dist/library.json` to the private Blob
 *   store, overwriting the previous one.
 *
 * The thin S3 and Blob calls around the pure planner
 * (`src/library/upload-plan.ts`).
 */
const ROOT = resolve(import.meta.dirname, "..");
const PLAN_PATH = resolve(ROOT, "dist/upload-plan.json");
const BUNDLE_PATH = resolve(ROOT, "dist/library.json");
/** The public Supabase Storage bucket media is served from. */
const MEDIA_BUCKET = "exercise-media";
/** The pathname `apps/library`'s build reads the bundle from. */
const LIBRARY_BLOB = "library.json";

const env = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

/** Supabase Storage's S3 endpoint, with the `SUPABASE_S3_*` secrets. */
const s3Client = () =>
  new S3Client({
    credentials: {
      accessKeyId: env("SUPABASE_S3_ACCESS_KEY_ID"),
      secretAccessKey: env("SUPABASE_S3_SECRET_ACCESS_KEY"),
    },
    endpoint: env("SUPABASE_S3_ENDPOINT"),
    forcePathStyle: true,
    region: env("SUPABASE_S3_REGION"),
  });

const listKeys = async (client: S3Client) => {
  const keys: string[] = [];
  const pages = paginateListObjectsV2({ client }, { Bucket: MEDIA_BUCKET });
  for await (const page of pages) {
    for (const object of page.Contents ?? []) {
      if (object.Key) {
        keys.push(object.Key);
      }
    }
  }
  return keys;
};

const planStep = async () => {
  const result = await loadContent(ROOT, { requireLfsPointers: true });
  if (!result.ok) {
    reportProblems(result.problems);
    process.exitCode = 1;
    return;
  }
  const media = [
    ...result.exercises.flatMap((exercise) =>
      [exercise.thumbnail, exercise.video].map((file) =>
        exerciseMedia(exercise.slug, file)
      )
    ),
    ...result.covers.map((cover) => coverMedia(cover.id, cover.image)),
  ];
  const uploads = planUploads(media, await listKeys(s3Client()));

  await mkdir(dirname(PLAN_PATH), { recursive: true });
  await writeFile(PLAN_PATH, `${JSON.stringify(uploads, null, 2)}\n`);
  console.log(
    `${uploads.length} of ${media.length} media objects to upload${uploads.map((upload) => `\n  ${upload.key}`).join("")}`
  );

  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    // The repo paths `git lfs pull --include` fetches: only the planned files.
    const include = uploads.map((upload) => upload.path).join(",");
    await appendFile(output, `count=${uploads.length}\ninclude=${include}\n`);
  }
};

const uploadStep = async () => {
  const uploads: PlannedUpload[] = JSON.parse(
    await readFile(PLAN_PATH, "utf8")
  );
  const client = s3Client();
  // One at a time, so at most one media file is in memory.
  for (const planned of uploads) {
    // biome-ignore lint/performance/noAwaitInLoops: bounds memory, see above
    const content = await readFile(resolve(ROOT, planned.path));
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (sha256 !== planned.oid) {
      throw new Error(
        `${planned.path}: content doesn't match its LFS oid (sha256 ${sha256}, expected ${planned.oid}): was its LFS object downloaded?`
      );
    }
    await client.send(
      new PutObjectCommand({
        Body: content,
        Bucket: MEDIA_BUCKET,
        CacheControl: planned.cacheControl,
        ContentType: planned.contentType,
        Key: planned.key,
      })
    );
    console.log(`uploaded ${planned.key}`);
  }
  console.log(`uploaded ${uploads.length} media objects`);
};

/**
 * Overwrites the fixed pathname. The Blob CDN may serve the previous version
 * for a while, but `apps/library`'s build reads it with `useCache: false`
 * (from origin storage), so the build the hook starts gets this one.
 */
const publishStep = async () => {
  const blob = await put(LIBRARY_BLOB, await readFile(BUNDLE_PATH), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: env("BLOB_READ_WRITE_TOKEN"),
  });
  console.log(`published ${blob.pathname}`);
};

const steps: Record<string, () => Promise<void>> = {
  plan: planStep,
  publish: publishStep,
  upload: uploadStep,
};
const step = steps[process.argv[2] ?? ""];
if (step) {
  await step();
} else {
  console.error("usage: pnpm release <plan|upload|publish>");
  process.exitCode = 1;
}
