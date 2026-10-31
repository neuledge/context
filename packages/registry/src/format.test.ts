import { type BuildResult, createIngestionReport } from "@neuledge/context";
import { expect, it } from "vitest";
import { formatBuilt } from "./format.js";

it.each([0, 1, 2])("reports %i parse failures once", (count) => {
  const result: BuildResult = {
    path: "package.db",
    sectionCount: 1,
    totalTokens: 10,
    skippedFiles: count,
    diagnostics: createIngestionReport(
      Array.from({ length: count }, (_, index) => ({
        path: `broken-${index}.md`,
        kind: "file",
        outcome: "parse-error",
      })),
    ),
  };
  const output = formatBuilt(result);
  expect(output.match(/\d+ parse failures?/g)).toEqual([
    `${count} parse failure${count === 1 ? "" : "s"}`,
  ]);
  expect(output).not.toContain("skipped");
});

it.each([0, 1, 2])("supports legacy results with %i skipped files", (count) => {
  const result: BuildResult = {
    path: "package.db",
    sectionCount: 1,
    totalTokens: 10,
    skippedFiles: count,
  };
  expect(formatBuilt(result)).toBe(
    "1 sections, 10 tokens" +
      (count > 0 ? `, ${count} file${count === 1 ? "" : "s"} skipped` : ""),
  );
});
