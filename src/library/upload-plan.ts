import type { Media } from "./types";

/** A media file of the Exercise Library, with the Exercise slug it belongs to. */
export type ReleaseMedia = Pick<
  Media,
  "contentType" | "extension" | "oid" | "path"
> & { slug: string };

/** An object the release uploads to the `exercise-media` bucket. */
export interface PlannedUpload {
  cacheControl: string;
  contentType: string;
  /** The object key: `<slug>/<oid>.<ext>`. */
  key: string;
  oid: string;
  /** The media file it is uploaded from, relative to the Exercise Library root. */
  path: string;
}

/**
 * The object key of a media file: `<slug>/<oid>.<ext>`. Part of the contract
 * with the monorepo's `apps/exercises`, which builds the same paths into its
 * media URLs (`mediaObjectPath` in `src/served-library.ts`): change both
 * together.
 */
export const mediaKey = ({
  extension,
  oid,
  slug,
}: Pick<ReleaseMedia, "extension" | "oid" | "slug">) =>
  `${slug}/${oid}.${extension}`;

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
