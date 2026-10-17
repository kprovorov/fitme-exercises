import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exerciseFiles,
  fakeOid,
  makeLibraryDir,
  prefix,
  writeFiles,
} from "../test/fixtures";
import { generateLibraryModule } from "./library-module";

let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await makeLibraryDir());
});

afterEach(async () => {
  await cleanup();
});

/** Writes the generated module next to the fixture and imports it, as the API does. */
const importModule = async (source: string) => {
  const file = join(dir, "library.ts");
  await writeFile(file, source);
  return import(pathToFileURL(file).href);
};

describe("generateLibraryModule", () => {
  it("generates a module holding every Exercise with its media URLs and the search index", async () => {
    await writeFiles(join(dir, "exercises"), {
      ...prefix("squat", exerciseFiles("Squat")),
    });

    const result = await generateLibraryModule({
      root: join(dir, "exercises"),
      supabaseUrl: "https://project.supabase.co/",
    });

    expect(result.ok).toBe(true);
    const { library } = await importModule(result.ok ? result.source : "");
    expect(library).toEqual({
      exercises: [
        {
          description: "Squat is a compound pushing movement.\n",
          instructions: "1. Lie on the bench.\n2. Press.\n",
          muscle_groups: ["chest", "triceps"],
          name: "Squat",
          slug: "squat",
          thumbnail_url: `https://project.supabase.co/storage/v1/render/image/public/exercise-media/squat/${fakeOid("a")}.png`,
          video_url: `https://project.supabase.co/storage/v1/object/public/exercise-media/squat/${fakeOid("b")}.mp4`,
        },
      ],
      hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      searchNames: ["squat"],
    });
  });

  it("fails on an invalid Exercise Library, naming every problem", async () => {
    await writeFiles(join(dir, "exercises"), {
      ...prefix("squat", {
        ...exerciseFiles("Squat"),
        "metadata.json": JSON.stringify({ muscle_groups: ["neck"] }),
      }),
    });

    const result = await generateLibraryModule({
      root: join(dir, "exercises"),
      supabaseUrl: "https://project.supabase.co",
    });

    expect(result).toEqual({
      ok: false,
      problems: [
        expect.stringMatching(
          /^squat\/metadata\.json: muscle_groups\.0: unknown muscle group "neck"/
        ),
      ],
    });
  });

  it.each([
    ["missing", undefined],
    ["not a URL", "project.supabase.co"],
    ["not https", "http://project.supabase.co"],
    ["not an origin (path)", "https://project.supabase.co/rest"],
    ["not an origin (query)", "https://project.supabase.co?x=1"],
    ["not an origin (fragment)", "https://project.supabase.co#x"],
    ["not an origin (credentials)", "https://user:pass@project.supabase.co"],
  ])("fails when the Supabase URL is %s", async (_, supabaseUrl) => {
    await writeFiles(join(dir, "exercises"), {
      ...prefix("squat", exerciseFiles("Squat")),
    });

    const result = await generateLibraryModule({
      root: join(dir, "exercises"),
      supabaseUrl,
    });

    expect(result).toEqual({
      ok: false,
      problems: [
        expect.stringMatching(/^SUPABASE_URL: must be the https URL/),
      ],
    });
  });
});
