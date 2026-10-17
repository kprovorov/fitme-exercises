import { describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";
import { muscleGroups } from "./library/muscle-groups";
import type { Exercise as LibraryExercise } from "./library/types";
import type { ExercisePage } from "./schemas";
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

/** An app serving an empty Exercise Library, for adding test routes to. */
const emptyApp = () =>
  createApp({ library: serveLibrary({ exercises: [] }, SUPABASE_URL) });

const currentEtag = async () => {
  const etag = (await app.request("/exercises/bench-press")).headers.get(
    "ETag"
  );
  if (!etag) {
    throw new Error("no ETag");
  }
  return etag;
};

const listApp = createApp({
  library: serveLibrary(
    {
      // sorted by Exercise slug, as the loader returns them
      exercises: [
        libraryExercise("bench-press", "Bench Press", ["chest", "triceps"]),
        libraryExercise("deadlift", "Deadlift", ["back", "hamstrings"]),
        libraryExercise("front-squat", "squat (front)", ["quadriceps"]),
        libraryExercise("pull-up", "Pull-Up", ["lats", "biceps"]),
        libraryExercise("squat", "Back Squat", ["quadriceps", "glutes"]),
      ],
    },
    SUPABASE_URL
  ),
});

const list = async (query = "") => {
  const response = await listApp.request(`/exercises${query}`);
  // an error body (400) is asserted with toEqual, which takes any shape
  const body = (await response.json()) as ExercisePage;
  return { body, status: response.status };
};

const names = (body: ExercisePage) =>
  body.data.map((exercise) => exercise.name);

describe("GET /exercises", () => {
  it("lists every Exercise alphabetically by name, as summaries", async () => {
    const { body, status } = await list();

    expect(status).toBe(200);
    expect(names(body)).toEqual([
      "Back Squat",
      "Bench Press",
      "Deadlift",
      "Pull-Up",
      "squat (front)",
    ]);
    expect(body.total).toBe(5);
    expect(body.hasMore).toBe(false);
    expect(body.data[0]).toEqual({
      muscle_groups: ["quadriceps", "glutes"],
      name: "Back Squat",
      slug: "squat",
      thumbnail_url: `https://project.supabase.co/storage/v1/render/image/public/exercise-media/squat/${fakeOid("a")}.png`,
      video_url: `https://project.supabase.co/storage/v1/object/public/exercise-media/squat/${fakeOid("b")}.mp4`,
    });
  });
});

describe("GET /exercises search", () => {
  it("matches the name case-insensitively, anywhere in it", async () => {
    const { body } = await list("?search=SQU");

    expect(names(body)).toEqual(["Back Squat", "squat (front)"]);
    expect(body).toMatchObject({ hasMore: false, total: 2 });
  });

  it("counts every match in total, not just the page", async () => {
    const { body } = await list("?search=squat&limit=1");

    expect(names(body)).toEqual(["Back Squat"]);
    expect(body).toMatchObject({ hasMore: true, total: 2 });
  });

  it("treats % and _ as literal characters", async () => {
    const wildcardApp = createApp({
      library: serveLibrary(
        {
          exercises: [
            libraryExercise("bench-press", "Bench Press"),
            libraryExercise("percent", "100% Effort"),
            libraryExercise("underscore", "Snake_Walk"),
          ],
        },
        SUPABASE_URL
      ),
    });
    const search = async (term: string) =>
      names(
        (await (
          await wildcardApp.request(
            `/exercises?search=${encodeURIComponent(term)}`
          )
        ).json()) as ExercisePage
      );

    expect(await search("%")).toEqual(["100% Effort"]);
    expect(await search("_")).toEqual(["Snake_Walk"]);
    expect(await search("e_w")).toEqual(["Snake_Walk"]);
    expect(await search("b%s")).toEqual([]);
  });

  it("ignores surrounding whitespace, and lists everything for a blank search", async () => {
    expect(names((await list("?search=%20press%20")).body)).toEqual([
      "Bench Press",
    ]);
    expect((await list("?search=%20%20")).body.total).toBe(5);
  });

  it("answers a search over 100 characters with 400", async () => {
    const { status } = await list(`?search=${"a".repeat(101)}`);

    expect(status).toBe(400);
  });

  it("answers no match with an empty page", async () => {
    expect((await list("?search=row")).body).toEqual({
      data: [],
      hasMore: false,
      total: 0,
    });
  });
});

describe("GET /exercises muscle group filter", () => {
  it("lists only Exercises with that muscle group", async () => {
    const { body } = await list("?muscle_group=quadriceps");

    expect(names(body)).toEqual(["Back Squat", "squat (front)"]);
    expect(body).toMatchObject({ hasMore: false, total: 2 });
  });

  it("combines with search", async () => {
    const { body } = await list("?muscle_group=quadriceps&search=back");

    expect(names(body)).toEqual(["Back Squat"]);
  });

  it("answers a known muscle group no Exercise has with an empty page", async () => {
    expect((await list("?muscle_group=calves")).body).toEqual({
      data: [],
      hasMore: false,
      total: 0,
    });
  });

  it("answers an unknown muscle group with 400 in the error shape", async () => {
    const { body, status } = await list("?muscle_group=neck");

    expect(status).toBe(400);
    expect(body).toEqual({
      error: { code: "invalid_request", message: expect.any(String) },
    });
  });

  it("is an enum of every muscle group in the OpenAPI definition", () => {
    const document = listApp.getOpenAPIDocument({
      info: { title: "Exercise Library API", version: "1" },
      openapi: "3.1.0",
    });
    const parameter = document.paths["/exercises"]?.get?.parameters?.find(
      (p) => "name" in p && p.name === "muscle_group"
    );

    expect(parameter).toMatchObject({
      in: "query",
      schema: { $ref: "#/components/schemas/MuscleGroup" },
    });
    expect(document.components?.schemas?.MuscleGroup).toEqual({
      enum: [...muscleGroups],
      type: "string",
    });
  });
});

describe("GET /exercises pagination", () => {
  it("pages with limit and offset, with total and hasMore across pages", async () => {
    const first = await list("?limit=2");
    const middle = await list("?limit=2&offset=2");
    const last = await list("?limit=2&offset=4");

    expect(names(first.body)).toEqual(["Back Squat", "Bench Press"]);
    expect(first.body).toMatchObject({ hasMore: true, total: 5 });
    expect(names(middle.body)).toEqual(["Deadlift", "Pull-Up"]);
    expect(middle.body).toMatchObject({ hasMore: true, total: 5 });
    expect(names(last.body)).toEqual(["squat (front)"]);
    expect(last.body).toMatchObject({ hasMore: false, total: 5 });
  });

  it("answers an offset past the end with an empty page", async () => {
    const { body, status } = await list("?offset=10");

    expect(status).toBe(200);
    expect(body).toEqual({ data: [], hasMore: false, total: 5 });
  });

  it("serves 20 Exercises by default", async () => {
    const slugs = Array.from(
      { length: 21 },
      (_, i) => `exercise-${String(i).padStart(2, "0")}`
    );
    const big = createApp({
      library: serveLibrary(
        { exercises: slugs.map((slug) => libraryExercise(slug, slug)) },
        SUPABASE_URL
      ),
    });

    const body = (await (
      await big.request("/exercises")
    ).json()) as ExercisePage;

    expect(body.data).toHaveLength(20);
    expect(body).toMatchObject({ hasMore: true, total: 21 });
  });

  it.each(["?limit=0", "?limit=51", "?limit=2.5", "?limit=abc", "?offset=-1"])(
    "answers %s with 400 in the error shape",
    async (query) => {
      const { body, status } = await list(query);

      expect(status).toBe(400);
      expect(body).toEqual({
        error: { code: "invalid_request", message: expect.any(String) },
      });
    }
  );

  it("accepts the limit bounds", async () => {
    expect((await list("?limit=1")).body.data).toHaveLength(1);
    expect((await list("?limit=50")).status).toBe(200);
  });
});

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

  it("keeps the headers the 200 would carry on a 304, except its body's", async () => {
    // a path no real route takes, under the content routes
    const withVary = emptyApp().get("/exercises/test/vary", (c) => {
      c.header("Vary", "Authorization");
      return c.json({ data: [] });
    });

    const response = await withVary.request("/exercises/test/vary", {
      headers: { "If-None-Match": "*" },
    });

    expect(response.status).toBe(304);
    expect(response.headers.get("Vary")).toBe("Authorization");
    expect(response.headers.get("Content-Type")).toBeNull();
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
    const withLater = emptyApp().get("/exercises/later/route", (c) =>
      c.json({ data: [] })
    );

    const later = await withLater.request("/exercises/later/route");
    const listed = await withLater.request("/exercises");

    expect(later.headers.get("ETag")).toMatch(LIBRARY_ETAG);
    expect(listed.headers.get("ETag")).toMatch(LIBRARY_ETAG);
  });

  it("keeps errors uncacheable, even with a matching If-None-Match", async () => {
    const etag = await currentEtag();
    const failing = emptyApp().get("/exercises/boom/now", () => {
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
    const failing = emptyApp().get("/boom", () => {
      throw new Error("boom");
    });
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
