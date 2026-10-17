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
 * video track: `moov/trak/mdia` with a `vide` handler and a sample table
 * (`minf/stbl`) describing at least one sample. Samples aren't decoded. Returns a problem, or
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
    .some(
      (mdia) =>
        children(bytes, mdia, "hdlr").some(isVideoHandler(bytes)) &&
        children(bytes, mdia, "minf")
          .flatMap((minf) => children(bytes, minf, "stbl"))
          .some((stbl) => hasSamples(bytes, stbl))
    );

const isVideoHandler = (bytes: Buffer) => (hdlr: Box) =>
  // hdlr: version and flags (4), pre_defined (4), then handler_type.
  hdlr.end - hdlr.start >= 12 &&
  bytes.toString("latin1", hdlr.start + 8, hdlr.start + 12) === "vide";

/** A sample table with a video sample description and at least one sample. */
const hasSamples = (bytes: Buffer, stbl: Box) => {
  const described = children(bytes, stbl, "stsd").some((stsd) =>
    hasVideoSampleEntries(bytes, stsd)
  );
  const sampled = [
    ...children(bytes, stbl, "stsz"),
    ...children(bytes, stbl, "stz2"),
  ].some(
    // stsz/stz2: version and flags (4), sample size or field size (4), then sample_count.
    (sizes) =>
      sizes.end - sizes.start >= 12 && bytes.readUInt32BE(sizes.start + 8) > 0
  );
  return described && sampled;
};

/** VisualSampleEntry content: SampleEntry (8) + visual fields (70). */
const VISUAL_SAMPLE_ENTRY_SIZE = 78;

/**
 * stsd: version and flags (4), entry_count, then that many sample entry
 * boxes. Each must be a well-formed visual sample entry with a width and
 * height.
 */
const hasVideoSampleEntries = (bytes: Buffer, stsd: Box) => {
  if (stsd.end - stsd.start < 8) {
    return false;
  }
  const count = bytes.readUInt32BE(stsd.start + 4);
  const entries = parseBoxes(bytes, stsd.start + 8, stsd.end);
  return (
    count > 0 &&
    entries !== undefined &&
    entries.length === count &&
    entries.every(
      (entry) =>
        entry.end - entry.start >= VISUAL_SAMPLE_ENTRY_SIZE &&
        // width and height follow SampleEntry (8) and 16 reserved bytes.
        bytes.readUInt16BE(entry.start + 24) > 0 &&
        bytes.readUInt16BE(entry.start + 26) > 0
    )
  );
};
