import { afterEach, describe, expect, it, vi } from "vitest";

describe("fetchLlmsTxt", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    spy.mockRestore();
  });

  it("fetches llms.txt and llms-full.txt", async () => {
    const mockIndex = "# Test\n> Description";
    const mockFull = "# Test\nFull content here.";

    spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/llms.txt")) {
        return new Response(mockIndex, { status: 200 });
      }
      if (urlStr.endsWith("/llms-full.txt")) {
        return new Response(mockFull, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    const { fetchLlmsTxt } = await import("./llmstxt.js");
    const result = await fetchLlmsTxt("https://example.com");

    expect(result.index).toBe(mockIndex);
    expect(result.full).toBe(mockFull);
    expect(result.baseUrl).toBe("https://example.com");
  });

  it("throws when llms.txt is not found", async () => {
    spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Not found", { status: 404 }),
    );

    const { fetchLlmsTxt } = await import("./llmstxt.js");
    await expect(fetchLlmsTxt("https://example.com")).rejects.toThrow(
      "Failed to fetch llms.txt",
    );
  });

  it("handles missing llms-full.txt gracefully", async () => {
    const mockIndex = "# Test\n> Description";

    spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith("/llms.txt")) {
        return new Response(mockIndex, { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    const { fetchLlmsTxt } = await import("./llmstxt.js");
    const result = await fetchLlmsTxt("https://example.com");

    expect(result.index).toBe(mockIndex);
    expect(result.full).toBeUndefined();
  });

  it("strips trailing slashes from base URL", async () => {
    const mockIndex = "# Test";

    spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      expect(urlStr).not.toContain("//llms.txt");
      return new Response(mockIndex, { status: 200 });
    });

    const { fetchLlmsTxt } = await import("./llmstxt.js");
    const result = await fetchLlmsTxt("https://example.com///");
    expect(result.baseUrl).toBe("https://example.com");
  });
});
