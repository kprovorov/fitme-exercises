import type { Problem } from "./library/types";

/** Prints every problem to stderr, each naming the Exercise and the file. */
export const reportProblems = (problems: Problem[]) => {
  const count = problems.length;
  console.error(`invalid: ${count} problem${count === 1 ? "" : "s"} found\n`);
  for (const problem of problems) {
    console.error(
      `  ${problem.exercise}  ${problem.file}\n    ${problem.message}`
    );
  }
};
