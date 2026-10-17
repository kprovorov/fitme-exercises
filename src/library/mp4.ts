/** Brands (in `ftyp`) that mark an ISO base media file as MP4. */
const MP4_BRANDS = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "iso9",
  "mp41",
  "mp42",
  "avc1",
  "M4V ",
]);

interface Box {
  /** Offset just past the box. */
  end: number;
  /** Offset of the box's content (after its header). */
  start: number;
  type: string;
}

/**
 * Checks that `bytes` is a structurally valid MP4 with a video track: an
 * `ftyp` box first with an MP4 brand, well-formed boxes throughout, and a
 * `moov/trak/mdia/hdlr` whose handler is `vide`. Returns a problem, or
 * undefined when the file is a valid MP4 video.
 */
export const checkMp4 = (bytes: Buffer): string | undefined => {
  const top = parseBoxes(bytes, 0, bytes.length);
  if (!top) {
    return "not a valid MP4: malformed box structure";
  }
  const [ftyp] = top;
  if (ftyp?.type !== "ftyp" || ftyp.end - ftyp.start < 8) {
    return "not a valid MP4: no ftyp box";
  }
  if (!brands(bytes, ftyp).some((brand) => MP4_BRANDS.has(brand))) {
    return "not a valid MP4: ftyp has no MP4 brand";
  }
  if (!hasVideoTrack(bytes, top)) {
    return "not a valid MP4 video: no video track";
  }
};

const parseBoxes = (
  bytes: Buffer,
  from: number,
  to: number
): Box[] | undefined => {
  const boxes: Box[] = [];
  let offset = from;
  while (offset < to) {
    if (to - offset < 8) {
      return;
    }
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (to - offset < 16) {
        return;
      }
      size = Number(bytes.readBigUInt64BE(offset + 8));
      header = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < header || offset + size > to) {
      return;
    }
    boxes.push({ end: offset + size, start: offset + header, type });
    offset += size;
  }
  return boxes;
};

const brands = (bytes: Buffer, ftyp: Box) => {
  const list = [bytes.toString("latin1", ftyp.start, ftyp.start + 4)];
  // Skip minor_version (4 bytes); the rest are compatible brands.
  for (let at = ftyp.start + 8; at + 4 <= ftyp.end; at += 4) {
    list.push(bytes.toString("latin1", at, at + 4));
  }
  return list;
};

const children = (bytes: Buffer, box: Box, type: string) =>
  (parseBoxes(bytes, box.start, box.end) ?? []).filter((b) => b.type === type);

const hasVideoTrack = (bytes: Buffer, top: Box[]) =>
  top
    .filter((box) => box.type === "moov")
    .flatMap((moov) => children(bytes, moov, "trak"))
    .flatMap((trak) => children(bytes, trak, "mdia"))
    .flatMap((mdia) => children(bytes, mdia, "hdlr"))
    // hdlr: version and flags (4), pre_defined (4), then handler_type.
    .some(
      (hdlr) =>
        hdlr.end - hdlr.start >= 12 &&
        bytes.toString("latin1", hdlr.start + 8, hdlr.start + 12) === "vide"
    );
