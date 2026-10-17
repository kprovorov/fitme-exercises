import { describe, expect, it, vi } from "vitest";
import { createApp } from "./create-app";
import { serveLibrary } from "./served-library";
import { fakeOid, libraryExercise } from "./test/fixtures";

const SUPABASE_URL = "https://project.supabase.co";

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

describe("GET /exercises/:slug", () => {
  it("answers the full Exercise", async () => {
    const response = await app.request("/exercises/bench-press");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        description: "Bench Press is a compound pushing movement.\n",
        instructions: "1. Lie on the bench.\n2. Press.\n",
        muscle_groups: ["chest", "triceps"],
        name: "Bench Press",
        slug: "bench-press",
        thumbnail_url: `https://project.supabase.co/storage/v1/render/image/public/exercise-media/bench-press/${fakeOid("a")}.png`,
        video_url: `https://project.supabase.co/storage/v1/object/public/exercise-media/bench-press/${fakeOid("b")}.mp4`,
      },
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
    const failing = createApp({ library: { exercises: [] } }).get(
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
