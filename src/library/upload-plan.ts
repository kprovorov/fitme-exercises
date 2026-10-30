import type { Media } from "./types";

/** A media file a release may upload, and where its object goes. */
export interface ReleaseMedia
  extends Pick<Media, "contentType" | "extension" | "oid"> {
  /** The bucket folder its object goes in: `<slug>` or `covers/<id>`. */
  dir: string;
  /** The media file, relative to the repo root. */
  path: string;
}

type LoadedMedia = Pick<Media, "contentType" | "extension" | "oid" | "path">;

/** An Exercise's media file (loaded from `exercises/`): its objects go under `<slug>/`. */
export const exerciseMedia = (
  slug: string,
  { contentType, extension, oid, path }: LoadedMedia
): ReleaseMedia => ({
  contentType,
  dir: slug,
  extension,
  oid,
  path: `exercises/${path}`,
});

/**
 * A Cover's image (loaded from `covers/`): its objects go under
 * `covers/<id>/`, apart from Exercise media (`coverObjectPath` in the
 * monorepo's `apps/library/src/served-library.ts`).
 */
export const coverMedia = (
  id: string,
  { contentType, extension, oid, path }: LoadedMedia
): ReleaseMedia => ({
  contentType,
  dir: `covers/${id}`,
  extension,
  oid,
  path: `covers/${path}`,
});

/** An object the release uploads to the `exercise-media` bucket. */
export interface PlannedUpload {
  cacheControl: string;
  contentType: string;
  /** The object key: `<slug>/<oid>.<ext>` or `covers/<id>/<oid>.<ext>`. */
  key: string;
  oid: string;
  /** The media file it is uploaded from, relative to the repo root. */
  path: string;
}

/**
 * The object key of a media file: `<dir>/<oid>.<ext>`. Part of the contract
 * with the monorepo's `apps/library`, which builds the same paths into its
 * media URLs (`mediaObjectPath` and `coverObjectPath` in
 * `src/served-library.ts`): change both together.
 */
export const mediaKey = ({
  dir,
  extension,
  oid,
}: Pick<ReleaseMedia, "dir" | "extension" | "oid">) =>
  `${dir}/${oid}.${extension}`;

/** Objects are content-addressed, so they never change: cache them forever. */
export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * Plans a release's media uploads: every media file whose object isn't in the
 * bucket yet (`existingKeys`). Objects already present are skipped; nothing is
 * ever overwritten or deleted.
 */
export const planUploads = (
  media: readonly ReleaseMedia[],
  existingKeys: Iterable<string>
): PlannedUpload[] => {
  const existing = new Set(existingKeys);
  return media
    .map((file) => ({
      cacheControl: MEDIA_CACHE_CONTROL,
      contentType: file.contentType,
      key: mediaKey(file),
      oid: file.oid,
      path: file.path,
    }))
    .filter((upload) => !existing.has(upload.key));
};
