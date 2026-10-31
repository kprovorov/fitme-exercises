import type { Problem } from "./library/types";

/** Prints every problem to stderr, each naming the Exercise or Cover and the file. */
export const reportProblems = (problems: Problem[]) => {
  const count = problems.length;
  console.error(`invalid: ${count} problem${count === 1 ? "" : "s"} found\n`);
  for (const problem of problems) {
    const owner =
      "exercise" in problem ? problem.exercise : `Cover ${problem.cover}`;
    console.error(`  ${owner}  ${problem.file}\n    ${problem.message}`);
  }
};
