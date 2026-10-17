import { createHash } from "node:crypto";
import type { ExerciseLibrary, Media } from "./library/types";
import type { Exercise } from "./schemas";

/** The public Supabase Storage bucket the Exercise Library's media is uploaded to. */
export const MEDIA_BUCKET = "exercise-media";

const TRAILING_SLASHES = /\/+$/;

/**
 * The Exercise Library as the API serves it: every Exercise as its response
 * object, media URLs resolved. Built once, at build time.
 */
export interface ServedLibrary {
  /** Sorted by Exercise slug. */
  exercises: Exercise[];
  /**
   * The sha256 of every Exercise as served (text, muscle groups and media
   * URLs, which carry the LFS oids): changes whenever any Exercise does.
   * Devices revalidate with it as the `ETag`.
   */
  hash: string;
}

/**
 * A media file's object path in the bucket: `<slug>/<lfs-oid>.<ext>`. The
 * path changes whenever the content does, so an object is never overwritten.
 */
export const mediaObjectPath = (slug: string, media: Media) =>
  `${slug}/${media.oid}.${media.extension}`;

/**
 * Resolves the media URLs of a validated Exercise Library on the Supabase
 * project at `supabaseUrl`: thumbnails through the image transformation
 * (render) endpoint, so clients only append `width`/`height`; videos at their
 * public object URL.
 */
export const serveLibrary = (
  library: ExerciseLibrary,
  supabaseUrl: string
): ServedLibrary => {
  const storage = `${supabaseUrl.replace(TRAILING_SLASHES, "")}/storage/v1`;
  const exercises = library.exercises.map((exercise): Exercise => {
    const { name, description, instructions } = exercise.locales.en;
    return {
      description,
      instructions,
      muscle_groups: exercise.muscle_groups,
      name,
      slug: exercise.slug,
      thumbnail_url: `${storage}/render/image/public/${MEDIA_BUCKET}/${mediaObjectPath(exercise.slug, exercise.thumbnail)}`,
      video_url: `${storage}/object/public/${MEDIA_BUCKET}/${mediaObjectPath(exercise.slug, exercise.video)}`,
    };
  });
  return {
    exercises,
    hash: createHash("sha256").update(JSON.stringify(exercises)).digest("hex"),
  };
};
