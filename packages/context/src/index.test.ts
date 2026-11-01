import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import { IngestionError } from "./index.js";

describe("public export surface", () => {
  it("keeps the documented ingestion exports", () => {
    expect(api.IngestionError).toBe(IngestionError);
    expect(IngestionError).toBeTypeOf("function");
  });

  it("hides internal ingestion helpers", () => {
    expect(api).not.toHaveProperty("createIngestionReport");
    expect(api).not.toHaveProperty("formatIngestionSummary");
    expect(api).not.toHaveProperty("ingestionErrorReason");
    expect(api).not.toHaveProperty("validateIngestion");
    expect(api).not.toHaveProperty("writeIngestionReport");
  });
});
