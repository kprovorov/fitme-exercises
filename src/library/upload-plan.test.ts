import { describe, expect, it } from "vitest";
import { fakeOid } from "../test/fixtures";
import { coverMedia, exerciseMedia, planUploads } from "./upload-plan";

const benchPressThumbnail = exerciseMedia("bench-press", {
  contentType: "image/png",
  extension: "png",
  oid: fakeOid("a"),
  path: "bench-press/thumbnail.png",
});
const benchPressVideo = exerciseMedia("bench-press", {
  contentType: "video/mp4",
  extension: "mp4",
  oid: fakeOid("b"),
  path: "bench-press/video.mp4",
});
const squatThumbnail = exerciseMedia("squat", {
  contentType: "image/webp",
  extension: "webp",
  oid: fakeOid("c"),
  path: "squat/thumbnail.webp",
});
const COVER = "3f2b8a4e-6c1d-4e5f-9a7b-1c2d3e4f5a6b";
const coverImage = coverMedia(COVER, {
  contentType: "image/jpeg",
  extension: "jpg",
  oid: fakeOid("d"),
  path: `${COVER}/image.jpg`,
});

describe("planUploads", () => {
  it("plans nothing when every object is already in the bucket", () => {
    const plan = planUploads(
      [benchPressThumbnail, benchPressVideo],
      [`bench-press/${fakeOid("a")}.png`, `bench-press/${fakeOid("b")}.mp4`]
    );

    expect(plan).toEqual([]);
  });

  it("plans only the objects missing from the bucket", () => {
    const plan = planUploads(
      [benchPressThumbnail, benchPressVideo, squatThumbnail],
      [`bench-press/${fakeOid("a")}.png`, "unrelated/object.png"]
    );

    expect(plan.map((upload) => upload.key)).toEqual([
      `bench-press/${fakeOid("b")}.mp4`,
      `squat/${fakeOid("c")}.webp`,
    ]);
  });

  it("plans each upload with its path, content type and immutable cache header", () => {
    const plan = planUploads([benchPressVideo, squatThumbnail], []);

    expect(plan).toEqual([
      {
        cacheControl: "public, max-age=31536000, immutable",
        contentType: "video/mp4",
        key: `bench-press/${fakeOid("b")}.mp4`,
        oid: fakeOid("b"),
        path: "exercises/bench-press/video.mp4",
      },
      {
        cacheControl: "public, max-age=31536000, immutable",
        contentType: "image/webp",
        key: `squat/${fakeOid("c")}.webp`,
        oid: fakeOid("c"),
        path: "exercises/squat/thumbnail.webp",
      },
    ]);
  });

  it("plans an object again when the same content moves to a new key", () => {
    // Same content (oid) under another Exercise slug is another object.
    const plan = planUploads(
      [
        exerciseMedia("incline", {
          ...benchPressThumbnail,
          path: "incline/thumbnail.png",
        }),
      ],
      [`bench-press/${fakeOid("a")}.png`]
    );

    expect(plan.map((upload) => upload.key)).toEqual([
      `incline/${fakeOid("a")}.png`,
    ]);
  });

  it("plans a Cover's image under covers/<id>/, from the covers folder", () => {
    const plan = planUploads(
      [coverImage, benchPressThumbnail],
      [`bench-press/${fakeOid("a")}.png`]
    );

    expect(plan).toEqual([
      {
        cacheControl: "public, max-age=31536000, immutable",
        contentType: "image/jpeg",
        key: `covers/${COVER}/${fakeOid("d")}.jpg`,
        oid: fakeOid("d"),
        path: `covers/${COVER}/image.jpg`,
      },
    ]);
  });

  it("skips a Cover's image already in the bucket", () => {
    expect(
      planUploads([coverImage], [`covers/${COVER}/${fakeOid("d")}.jpg`])
    ).toEqual([]);
  });
});
