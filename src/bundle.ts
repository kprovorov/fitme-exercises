import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { bundleLibrary } from "./library/bundle";
import { reportProblems } from "./report";

/**
 * Bundles the Exercise Library (`exercises/`) as `library.json`:
 * `pnpm bundle [out]` (default `dist/library.json`). Reads only Git LFS
 * pointers; an invalid Exercise Library prints its problems and exits 1.
 */
const ROOT = resolve(import.meta.dirname, "..");
const out = resolve(process.argv[2] ?? resolve(ROOT, "dist/library.json"));
const result = await bundleLibrary(resolve(ROOT, "exercises"));

if (result.ok) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, result.json);
  console.log(`bundled the Exercise Library to ${out}`);
} else {
  reportProblems(result.problems);
  process.exitCode = 1;
}
