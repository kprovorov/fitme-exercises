import { describe, expect, it } from "vitest";
import { fakeOid } from "../test/fixtures";
import { planUploads } from "./upload-plan";

const benchPressThumbnail = {
  contentType: "image/png",
  extension: "png",
  oid: fakeOid("a"),
  path: "bench-press/thumbnail.png",
  slug: "bench-press",
};
const benchPressVideo = {
  contentType: "video/mp4",
  extension: "mp4",
  oid: fakeOid("b"),
  path: "bench-press/video.mp4",
  slug: "bench-press",
};
const squatThumbnail = {
  contentType: "image/webp",
  extension: "webp",
  oid: fakeOid("c"),
  path: "squat/thumbnail.webp",
  slug: "squat",
};

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
        path: "bench-press/video.mp4",
      },
      {
        cacheControl: "public, max-age=31536000, immutable",
        contentType: "image/webp",
        key: `squat/${fakeOid("c")}.webp`,
        oid: fakeOid("c"),
        path: "squat/thumbnail.webp",
      },
    ]);
  });

  it("plans an object again when the same content moves to a new key", () => {
    // Same content (oid) under another Exercise slug is another object.
    const plan = planUploads(
      [
        {
          ...benchPressThumbnail,
          path: "incline/thumbnail.png",
          slug: "incline",
        },
      ],
      [`bench-press/${fakeOid("a")}.png`]
    );

    expect(plan.map((upload) => upload.key)).toEqual([
      `incline/${fakeOid("a")}.png`,
    ]);
  });
});
