import { describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";
import type { Exercise as LibraryExercise } from "./library/types";
import { serveLibrary } from "./served-library";
import { fakeOid, libraryExercise } from "./test/fixtures";

const SUPABASE_URL = "https://project.supabase.co";

/** The library hash, a sha256, quoted. */
const LIBRARY_ETAG = /^"[0-9a-f]{64}"$/;

const app = createApp({
  library: serveLibrary(
    {
      exercises: [
        libraryExercise("bench-press", "Bench Press"),
        libraryExercise("squat", "Squat"),
      ],
    },
    SUPABASE_URL
  ),
});

const currentEtag = async () => {
  const etag = (await app.request("/exercises/bench-press")).headers.get(
    "ETag"
  );
  if (!etag) {
    throw new Error("no ETag");
  }
  return etag;
};

describe("GET /exercises/:slug", () => {
  it("answers the full Exercise", async () => {
    const response = await app.request("/exercises/bench-press");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      description: "Bench Press is a compound pushing movement.\n",
      instructions: "1. Lie on the bench.\n2. Press.\n",
      muscle_groups: ["chest", "triceps"],
      name: "Bench Press",
      slug: "bench-press",
      thumbnail_url: `https://project.supabase.co/storage/v1/render/image/public/exercise-media/bench-press/${fakeOid("a")}.png`,
      video_url: `https://project.supabase.co/storage/v1/object/public/exercise-media/bench-press/${fakeOid("b")}.mp4`,
    });
  });

  it("answers an unknown Exercise slug with 404 in the error shape", async () => {
    const response = await app.request("/exercises/deadlift");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Exercise not found" },
    });
  });
});

describe("device caching", () => {
  it("lets devices cache a content response for an hour, tagged with the library hash", async () => {
    const response = await app.request("/exercises/bench-press");

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(response.headers.get("ETag")).toMatch(LIBRARY_ETAG);
  });

  it("answers 304 with no body when If-None-Match holds the current ETag", async () => {
    const etag = await currentEtag();

    const response = await app.request("/exercises/squat", {
      headers: { "If-None-Match": etag },
    });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("ETag")).toBe(etag);
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });

  it.each([
    ["one of several", (etag: string) => `"old", ${etag}`],
    ["weak", (etag: string) => `W/${etag}`],
    ["*", () => "*"],
  ])("answers 304 when If-None-Match is %s", async (_, ifNoneMatch) => {
    const etag = await currentEtag();

    const response = await app.request("/exercises/squat", {
      headers: { "If-None-Match": ifNoneMatch(etag) },
    });

    expect(response.status).toBe(304);
  });

  it("answers normally when If-None-Match holds another ETag", async () => {
    const response = await app.request("/exercises/squat", {
      headers: { "If-None-Match": `"${"0".repeat(64)}"` },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ slug: "squat" });
  });

  it("applies to every content route, including ones added later", async () => {
    const withList = createApp({
      library: serveLibrary({ exercises: [] }, SUPABASE_URL),
    }).get("/exercises", (c) => c.json({ data: [] }));

    const response = await withList.request("/exercises");

    expect(response.headers.get("ETag")).toMatch(LIBRARY_ETAG);
  });

  it("keeps errors uncacheable, even with a matching If-None-Match", async () => {
    const etag = await currentEtag();
    const failing = createApp({
      library: serveLibrary({ exercises: [] }, SUPABASE_URL),
    }).get("/exercises/boom/now", () => {
      throw new Error("boom");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {
      // keep the expected error out of the test output
    });

    const responses = [
      await app.request("/exercises/deadlift", {
        headers: { "If-None-Match": etag },
      }),
      await app.request("/exercises/squat/nope"),
      await failing.request("/exercises/boom/now"),
    ];

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 500,
    ]);
    for (const response of responses) {
      expect(response.headers.get("ETag")).toBeNull();
      expect(response.headers.get("Cache-Control")).toBeNull();
    }
    errors.mockRestore();
  });

  it("doesn't cache /health", async () => {
    const response = await app.request("/health");

    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBeNull();
  });

  it.each([
    [
      "a name",
      (exercise: LibraryExercise) => ({
        ...exercise,
        locales: { en: { ...exercise.locales.en, name: "Flat Bench Press" } },
      }),
    ],
    [
      "a description",
      (exercise: LibraryExercise) => ({
        ...exercise,
        locales: { en: { ...exercise.locales.en, description: "Pressing.\n" } },
      }),
    ],
    [
      "muscle groups",
      (exercise: LibraryExercise) => ({
        ...exercise,
        muscle_groups: ["chest" as const],
      }),
    ],
    [
      "a thumbnail",
      (exercise: LibraryExercise) => ({
        ...exercise,
        thumbnail: { ...exercise.thumbnail, oid: fakeOid("c") },
      }),
    ],
    [
      "a video",
      (exercise: LibraryExercise) => ({
        ...exercise,
        video: { ...exercise.video, oid: fakeOid("c") },
      }),
    ],
  ])("changes the ETag when %s changes", async (_, change) => {
    const etag = await currentEtag();
    const changed = createApp({
      library: serveLibrary(
        {
          exercises: [
            change(libraryExercise("bench-press", "Bench Press")),
            libraryExercise("squat", "Squat"),
          ],
        },
        SUPABASE_URL
      ),
    });

    const response = await changed.request("/exercises/squat", {
      headers: { "If-None-Match": etag },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toMatch(LIBRARY_ETAG);
    expect(response.headers.get("ETag")).not.toBe(etag);
  });
});

describe("GET /health", () => {
  it("is public", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe("errors", () => {
  it("answers an unknown route with a JSON 404", async () => {
    const response = await app.request("/nope");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "not_found", message: "Route not found" },
    });
  });

  it("answers a thrown error with a JSON 500", async () => {
    const failing = createApp({ library: { exercises: [], hash: "0" } }).get(
      "/boom",
      () => {
        throw new Error("boom");
      }
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => {
      // keep the expected error out of the test output
    });

    const response = await failing.request("/boom");

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "internal_error", message: "Internal server error" },
    });
    errors.mockRestore();
  });
});
