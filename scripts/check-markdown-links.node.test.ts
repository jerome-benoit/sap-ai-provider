import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractDocument, run } from "./check-markdown-links";

const directories: string[] = [];
const servers: Server[] = [];
const configuration = {
  aliveStatusCodes: [200, 206, 403],
  fallbackRetryDelay: "0ms",
  httpHeaders: [] as { headers: Record<string, string>; urls: string[] }[],
  ignoreDisable: false,
  ignorePatterns: [] as { pattern: string }[],
  replacementPatterns: [] as { global?: boolean; pattern: string; replacement: string }[],
  retryCount: 2,
  retryOn429: true,
  timeout: "1s",
};

/**
 * Write a document and an isolated link policy.
 * @param source - Markdown fixture
 * @param overrides - Policy changes for this fixture
 * @returns Paths and CLI arguments for the fixture
 */
function fixture(source: string, overrides: Partial<typeof configuration> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "sap-ai-link-test-"));
  directories.push(directory);
  const document = join(directory, "document with spaces.md");
  const policy = join(directory, "policy.json");
  writeFileSync(document, source);
  writeFileSync(policy, JSON.stringify({ ...configuration, ...overrides }));
  return { args: ["--config", policy, document], directory, document, policy };
}

/**
 * Start a local HTTP fixture without external network requests.
 * @param handler - Request handler
 * @returns Loopback base URL
 */
async function serve(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP fixture port");
  return `http://127.0.0.1:${String(address.port)}`;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    }),
  );
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
  vi.restoreAllMocks();
});

describe("Markdown link extraction", () => {
  it("extracts Markdown, references, bare URLs, images, and inline HTML without code or comments", () => {
    const document = extractDocument(
      [
        "[reference][target] ![image](image.png)",
        "[target]: https://valid.test/reference",
        "https://valid.test/bare",
        '<a href="https://valid.test/a?a=1&amp;b=2">HTML</a>',
        '<img src="inline.png"><iframe src="frame.html"></iframe>',
        '<!-- <a href="comment.html">ignored</a> -->',
        "`[code](inline-code.html)`",
        '```html\n<a href="fenced-code.html">ignored</a>\n```',
      ].join("\n\n"),
    );
    expect([...document.links]).toEqual(
      expect.arrayContaining([
        "https://valid.test/reference",
        "image.png",
        "https://valid.test/bare",
        "https://valid.test/a?a=1&b=2",
        "inline.png",
        "frame.html",
      ]),
    );
    expect(document.links.has("comment.html")).toBe(false);
    expect(document.links.has("inline-code.html")).toBe(false);
    expect(document.links.has("fenced-code.html")).toBe(false);
  });

  it("collects duplicate heading slugs and explicit HTML anchors", () => {
    const document = extractDocument(
      '# A **heading**\n\n# A **heading**\n\n<a name="old"></a><div id="explicit"></div>',
    );
    expect(document.anchors).toEqual(new Set(["a-heading", "a-heading-1", "explicit", "old"]));
  });

  it("retains legacy encoded ATX fragments without adding Setext or rendered-HTML headings", () => {
    const document = extractDocument(
      "Setext\n======\n\n# Héllo\n\n# <em>word</em>\n\n<h2>HTML heading</h2>",
    );
    expect(document.anchors).toEqual(new Set(["emwordem", "h%C3%A9llo"]));
  });

  it("preserves the existing inline disable directives", () => {
    const document = extractDocument(
      [
        "<!-- markdown-link-check-disable -->",
        "[disabled](disabled.txt)",
        "<!-- markdown-link-check-enable -->",
        "<!-- markdown-link-check-disable-next-line -->",
        "[next](next.txt)",
        "[line](line.txt) <!-- markdown-link-check-disable-line -->",
        "[kept](kept.txt)",
      ].join("\n"),
    );
    expect([...document.links]).toEqual(["kept.txt"]);
  });
});

describe("Markdown link checking", () => {
  it("preserves backend defaults when policy fields are omitted", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(200).end();
    });
    const test = fixture(`[default policy](${base}/default-policy)`);
    writeFileSync(test.policy, JSON.stringify({ timeout: "1s" }));
    expect(await run(test.args)).toBe(0);
    expect(requested).toEqual(new Set(["/default-policy"]));
  });

  it("checks disabled broken links when ignoreDisable is enabled", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(404).end();
    });
    const test = fixture(
      `<!-- markdown-link-check-disable -->\n[disabled](${base}/disabled)\n<!-- markdown-link-check-enable -->`,
    );
    expect(await run(test.args)).toBe(0);
    expect(requested.size).toBe(0);
    writeFileSync(test.policy, JSON.stringify({ ignoreDisable: true, timeout: "1s" }));
    expect(await run(test.args)).toBe(1);
    expect(requested).toEqual(new Set(["/disabled"]));
  });

  it("checks readable relative files, directories, escaped filenames, and same-document anchors", async () => {
    const test = fixture(
      '# Héllo\n\n[anchor](#h%C3%A9llo) [file](asset%20%C3%A9.txt) [dir](assets/)\n\n<a id="named"></a><a href="#named">HTML anchor</a>',
    );
    writeFileSync(join(test.directory, "asset é.txt"), "asset");
    mkdirSync(join(test.directory, "assets"));
    expect(await run(test.args)).toBe(0);
  });

  it("rejects missing files and anchors without aborting the remaining links", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(200).end();
    });
    const test = fixture(`[missing](missing.txt) [anchor](#missing) [reachable](${base}/present)`);
    expect(await run(test.args)).toBe(1);
    expect(requested).toEqual(new Set(["/present"]));
  });

  it("accepts exact configured statuses, follows redirects, sends headers, and does not crawl target pages", async () => {
    const requested: string[] = [];
    const base = await serve((request, response) => {
      requested.push(request.url ?? "");
      if (request.headers["x-link-check"] !== "fixture") {
        response.writeHead(401).end();
      } else if (request.url === "/redirect") {
        response.writeHead(302, { location: "/ok" }).end();
      } else if (request.url === "/partial") {
        response.writeHead(206).end();
      } else if (request.url === "/forbidden") {
        response.writeHead(403).end();
      } else if (request.url === "/ok") {
        response
          .writeHead(200, { "content-type": "text/html" })
          .end('<a href="/must-not-crawl">not a document link</a>');
      } else {
        response.writeHead(404).end();
      }
    });
    const test = fixture(
      `[ok](${base}/ok) [partial](${base}/partial) [forbidden](${base}/forbidden)\n\n<a href="${base}/redirect">redirect</a>`,
      { httpHeaders: [{ headers: { "x-link-check": "fixture" }, urls: [base] }] },
    );
    expect(await run(test.args)).toBe(0);
    expect(requested).not.toContain("/must-not-crawl");
  });

  it("applies configured headers only to matching URL prefixes", async () => {
    const base = await serve((request, response) => {
      const expected = request.url === "/private" ? "fixture" : undefined;
      response.writeHead(request.headers["x-link-check"] === expected ? 200 : 401).end();
    });
    const test = fixture(`[private](${base}/private) [public](${base}/public)`, {
      httpHeaders: [{ headers: { "x-link-check": "fixture" }, urls: [`${base}/private`] }],
    });
    expect(await run(test.args)).toBe(0);
  });

  it("passes customized alive statuses through to the existing backend", async () => {
    const base = await serve((_request, response) => {
      response.writeHead(418).end();
    });
    const test = fixture(`[custom](${base}/custom)`, { aliveStatusCodes: [200, 418] });
    expect(await run(test.args)).toBe(0);
  });

  it("rejects unaccepted 2xx, broken links, and server errors without retrying those errors", async () => {
    const gets: string[] = [];
    const base = await serve((request, response) => {
      if (request.method === "GET") gets.push(request.url ?? "");
      response
        .writeHead(request.url === "/no-content" ? 204 : request.url === "/error" ? 500 : 404)
        .end();
    });
    for (const path of ["/no-content", "/missing", "/error"]) {
      const test = fixture(`[target](${base}${path})`);
      expect(await run(test.args)).toBe(1);
    }
    expect(gets.filter((path) => path === "/error")).toHaveLength(1);
  });

  it("does not request ignored links and preserves placeholder exclusions", async () => {
    let requests = 0;
    const base = await serve((_request, response) => {
      requests++;
      response.writeHead(404).end();
    });
    const test = fixture(
      `[ignored](${base}/ignored) [placeholder](https://your-host.invalid/path)`,
      { ignorePatterns: [{ pattern: "/ignored$" }, { pattern: "^https://your-" }] },
    );
    expect(await run(test.args)).toBe(0);
    expect(requests).toBe(0);
  });

  it("retries only rate limits and stops after two retries", async () => {
    const gets: Record<string, number> = {};
    const base = await serve((request, response) => {
      const path = request.url ?? "";
      if (request.method === "GET") gets[path] = (gets[path] ?? 0) + 1;
      const recovered = path === "/recover" && (gets[path] ?? 0) >= 3;
      response.writeHead(recovered ? 200 : 429, { "retry-after": "0" }).end();
    });
    const recovered = fixture(`[recover](${base}/recover)`);
    expect(await run(recovered.args)).toBe(0);
    const persistent = fixture(`[persistent](${base}/persistent)`);
    expect(await run(persistent.args)).toBe(1);
    expect(gets).toEqual({ "/persistent": 3, "/recover": 3 });
  });

  it("retries rate limits when Retry-After is absent", async () => {
    const gets: Record<string, number> = {};
    const base = await serve((request, response) => {
      const path = request.url ?? "";
      if (request.method === "GET") gets[path] = (gets[path] ?? 0) + 1;
      response.writeHead((gets[path] ?? 0) >= 2 ? 200 : 429).end();
    });
    const test = fixture(`[fallback](${base}/fallback)`);
    expect(await run(test.args)).toBe(0);
    expect(gets).toEqual({ "/fallback": 2 });
  });

  it("fails timed-out requests", async () => {
    const base = await serve(() => undefined);
    const test = fixture(`[timeout](${base}/timeout)`, { timeout: "25ms" });
    expect(await run(test.args)).toBe(1);
  });

  it("fails invalid email addresses without ignoring mailto links", async () => {
    const test = fixture("[invalid email](mailto:not-an-address)");
    expect(await run(test.args)).toBe(1);
  });

  it("checks explicit file URLs and rejects unsupported protocols instead of hiding them", async () => {
    const readable = fixture(`[file](${import.meta.url})`);
    expect(await run(readable.args)).toBe(0);
    const unsupported = fixture("[unsupported](custom:unsupported)");
    expect(await run(unsupported.args)).toBe(1);
  });

  it("fails closed for invalid policy and unreadable inputs", async () => {
    const test = fixture("");
    writeFileSync(test.policy, JSON.stringify({ ...configuration, timeout: 0 }));
    expect(await run(test.args)).toBe(1);
    writeFileSync(test.policy, JSON.stringify(configuration));
    expect(await run(["--config", test.policy, join(test.directory, "missing.md")])).toBe(1);
  });
});
