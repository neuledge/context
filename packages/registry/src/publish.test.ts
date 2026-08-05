import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkPackageExists, publishPackage } from "./publish.js";

/** A server that drops the first `failures` connections, then answers `status`. */
function flakyServer(failures: number, status: number) {
  let seen = 0;
  const server = createServer((_req, res) => {
    seen++;
    if (seen <= failures) {
      res.socket?.destroy();
      return;
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end("{}");
  });

  return new Promise<{ server: Server; url: string; hits: () => number }>(
    (resolve) => {
      server.listen(0, () => {
        const address = server.address();
        const port = typeof address === "object" && address ? address.port : 0;
        resolve({
          server,
          url: `http://127.0.0.1:${port}`,
          hits: () => seen,
        });
      });
    },
  );
}

describe("publish", () => {
  let running: Server | undefined;

  afterEach(() => {
    running?.close();
    running = undefined;
  });

  const dbPath = join(mkdtempSync(join(tmpdir(), "publish-test-")), "pkg.db");
  writeFileSync(dbPath, "x");

  // One dropped connection out of ~58 packages used to fail the whole nightly
  // publish, so transient faults have to survive rather than abort the run.
  it("retries a dropped connection instead of failing the package", async () => {
    const { server, url, hits } = await flakyServer(2, 404);
    running = server;
    process.env.REGISTRY_SERVER_URL = url;
    process.env.REGISTRY_PUBLISH_KEY = "test-key";

    await expect(checkPackageExists("npm", "preact", "latest")).resolves.toBe(
      null,
    );
    expect(hits()).toBe(3);
  });

  it("gives up immediately on a 4xx and keeps the server's message", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(403);
      res.end("bad key");
    });
    running = server;
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.env.REGISTRY_SERVER_URL = `http://127.0.0.1:${port}`;
    process.env.REGISTRY_PUBLISH_KEY = "test-key";

    await expect(
      publishPackage("npm", "preact", "latest", dbPath),
    ).rejects.toThrow(/403 Forbidden — bad key/);
  });
});
