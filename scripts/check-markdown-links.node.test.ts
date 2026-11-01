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

  it("preserves userinfo and complete targets in HTTPS autolinks", () => {
    const password = `${"x".repeat(64)}%40ss`;
    const url = `https://reader:${password}@example.com:8443/private?mode=review#section`;
    expect(extractDocument(url).links).toEqual(new Set([url]));
  });

  it.each([
    "https://example。sub．example｡com/missing",
    "http://www.example。sub．example｡com/missing",
    "https://ex%61mple%2Ecom/a%2Fb?q=c%3Fd#e%23f",
    "http://www.ex-ample%2ecom/missing",
    "http://www.example%2Ecom%2E/missing",
    "http://www.example%2Ecom%E3%80%82:8443/path?q=1#part",
    `http://www.${"%C3%BC".repeat(32)}/missing`,
    "https://example.com/path。segment?q=a，b#c）d",
    "https://example.com/path𐄀segment",
    "https://example。com。",
  ])("preserves the complete destination of %s", (url) => {
    const source = url.startsWith("http://www.") ? url.slice(7) : url;
    const links = [...extractDocument(source).links];
    expect(links.map((link) => new URL(link).href)).toEqual([new URL(url).href]);
  });

  it("normalizes mapped HTTP hostnames without rewriting other URL components", () => {
    const document = extractDocument(
      "[target](https://reader:p%40ss@ｅx%61mple.com:8443/a%2Fb/../c?q=d%3Fe#f%23g)",
    );
    expect(document.links).toEqual(
      new Set(["https://reader:p%40ss@example.com:8443/a%2Fb/../c?q=d%3Fe#f%23g"]),
    );
  });

  it("recovers later WWW destinations after malformed encoded labels", () => {
    const document = extractDocument(
      "www.bad%ZZ.www.after-invalid.test/_part_/file\n\nwww.bad%2.www.after-short.test/_part_/file",
    );
    expect(document.links).toEqual(
      new Set([
        "http://www.after-invalid.test/_part_/file",
        "http://www.after-short.test/_part_/file",
      ]),
    );
  });

  it("separates HTTP authorities from adjacent text and URL suffixes", () => {
    const document = extractDocument(
      "https://valid.test<reader@example.net/path>\n\nhttps://valid.test/private?email=reader@example.net#part",
    );
    expect(document.links).toEqual(
      new Set([
        "https://valid.test",
        "https://valid.test/private?email=reader@example.net#part",
        "mailto:reader@example.net",
      ]),
    );
  });

  it("preserves DNS root dots before URL suffixes without consuming sentence punctuation", () => {
    const document = extractDocument(
      [
        "http://example.test./path?x=1#part",
        "https://example.test.:8443/private",
        "https://example.test.?q=1#part",
        "www.bücher.de./é?x=1#part",
        "https://sentence.test.",
        "(www.sentence.test).",
        "@www.punctuation.test",
        "note.www.punctuation.test",
        "www.trailing.test@",
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set([
        "http://example.test./path?x=1#part",
        "http://www.punctuation.test",
        "http://www.sentence.test",
        "http://www.trailing.test",
        "http://www.xn--bcher-kva.de./%C3%A9?x=1#part",
        "https://example.test.:8443/private",
        "https://example.test.?q=1#part",
        "https://sentence.test",
      ]),
    );
  });

  it("preserves deep DNS hosts and IPv6 targets", () => {
    const host = `${"a.".repeat(12)}example.test`;
    const document = extractDocument(
      `https://${host}/path?x=1#part\n\nwww.${host}/path?x=1#part\n\nhttps://[::1]:8080/path?x=1#part`,
    );
    expect(document.links).toEqual(
      new Set([
        `http://www.${host}/path?x=1#part`,
        `https://${host}/path?x=1#part`,
        "https://[::1]:8080/path?x=1#part",
      ]),
    );
  });

  it("does not accept a prefix of a malformed deep punycode hostname", () => {
    const document = extractDocument(`https://${"xn--a.".repeat(64)}invalid-/missing`);
    expect(document.links).toEqual(new Set());
  });

  it("does not reclassify deep email addresses as WWW autolinks", () => {
    const host = `${"a.".repeat(12)}example.test`;
    const document = extractDocument(
      [
        `reader@www.${host}`,
        `reader@prefix.www.${host}`,
        `contact:reader@prefix.www.${host}`,
        `www.reader@${host}`,
        `www.reader:8080@${host}`,
      ].join("\n\n"),
    );
    expect(document.links).toEqual(new Set());
  });

  it("normalizes www autolinks with punctuation, ports, and Unicode", () => {
    const document = extractDocument(
      "(www.example.com/a(b)). www.example.com:8080/path?x=1&y=2#part www.bücher.de/é www.example.com/a@b?email=c@d#x@y",
    );
    expect(document.links).toEqual(
      new Set([
        "http://www.example.com/a(b)",
        "http://www.example.com/a@b?email=c@d#x@y",
        "http://www.example.com:8080/path?x=1&y=2#part",
        "http://www.xn--bcher-kva.de/%C3%A9",
      ]),
    );
  });

  it("preserves complete WWW paths before inline emphasis splits them", () => {
    const document = extractDocument(
      [
        "prefix www.example.test/_missing_/file then www.other.test/*part*/file",
        "` https://code.test/`www.after-code.test/_part_/file",
        "*www.wrapped.test/_part_/file*",
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set([
        "http://www.after-code.test/_part_/file",
        "http://www.example.test/_missing_/file",
        "http://www.other.test/*part*/file",
        "http://www.wrapped.test/_part_/file",
      ]),
    );
  });

  it("preserves nested WWW path data and later destinations across inline offsets", () => {
    const first = `www.example.com/${"www.".repeat(2048)}tail.test`;
    const document = extractDocument(`**prefix** text ${first} next www.second.test/_part_/file`);
    expect(document.links).toEqual(
      new Set([`http://${first}`, "http://www.second.test/_part_/file"]),
    );
  });

  it("retains native email precedence for WWW-prefixed local parts", () => {
    const document = extractDocument(
      "www.name!tag@example.com www.name+tag@example.com foo!www.name+tag@example.com",
    );
    expect(document.links).toEqual(
      new Set([
        "mailto:foo!www.name+tag@example.com",
        "mailto:www.name!tag@example.com",
        "mailto:www.name+tag@example.com",
      ]),
    );
  });

  it("distinguishes enclosing delimiters from unmatched terminal URL markers", () => {
    const document = extractDocument(
      [
        "www.literal-star.test/file*",
        "www.literal-stars.test/file**",
        "www.literal-tildes.test/file~~",
        "*www.emphasis.test/_part_/file*",
        "**www.strong.test/_part_/file**",
        "_www.underscore.test/*part*/file_",
        "__www.strong-underscore.test/*part*/file__",
        "~~www.strike.test/_part_/file~~",
        "_www.bare.test_",
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set([
        "http://www.bare.test",
        "http://www.emphasis.test/_part_/file",
        "http://www.literal-star.test/file*",
        "http://www.literal-stars.test/file**",
        "http://www.literal-tildes.test/file~~",
        "http://www.strike.test/_part_/file",
        "http://www.strong-underscore.test/*part*/file",
        "http://www.strong.test/_part_/file",
        "http://www.underscore.test/*part*/file",
      ]),
    );
  });

  it("preserves URL-internal bracket and backtick syntax as URI data", () => {
    const document = extractDocument(
      "www.brackets.test/[visible](missing.txt)\n\nwww.code-path.test/[`code`]",
    );
    expect(document.links).toEqual(
      new Set([
        "http://www.brackets.test/%5Bvisible%5D(missing.txt)",
        "http://www.code-path.test/%5B%60code%60%5D",
      ]),
    );
  });

  it("preserves entity and escape barriers without hiding later WWW paths", () => {
    const document = extractDocument(
      [
        "\\@www.escaped.test/_hidden_/file",
        "&copy;www.entity.test/_hidden_/file",
        "\\@prefix www.visible.test/_part_/file",
        "&copy; www.spaced.test/_part_/file",
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set(["http://www.spaced.test/_part_/file", "http://www.visible.test/_part_/file"]),
    );
  });

  it("keeps WWW paths out of code, attributes, and existing link labels", () => {
    const document = extractDocument(
      [
        "[www.label.test/_part_/file](target.txt)",
        "[www.reference.test/[nested]/_part_][target]",
        "![www.image.test/_part_/file](image.png)",
        "[target]: reference.txt",
        '<a href="html.txt">www.body.test/_part_/file</a>',
        '<span title="www.attribute.test/_part_/file">text</span>',
        "`www.code.test/_part_/file`",
        "```text\nwww.fenced.test/_part_/file\n```",
        "<!-- www.comment.test/_part_/file -->",
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set(["html.txt", "image.png", "reference.txt", "target.txt"]),
    );
  });

  it("preserves long HTTP and WWW destinations across changing document lengths", () => {
    const http = `https://length.test/${"x".repeat(10000)}/missing`;
    const www = `www.length.test/${"x".repeat(25000)}/_missing_/file`;
    expect(extractDocument(http).links).toEqual(new Set([http]));
    expect(extractDocument("www.short.test/_part_/file").links).toEqual(
      new Set(["http://www.short.test/_part_/file"]),
    );
    expect(extractDocument(www).links).toEqual(new Set([`http://${www}`]));
    expect(extractDocument(http).links).toEqual(new Set([http]));
  });

  it("does not hide valid WWW paths after rejected hostname or email spans", () => {
    const document = extractDocument(
      [
        `reader@${"www.".repeat(64)}example.test www.after-email.test/_part_/file`,
        "www.invalid-.www.after-label.test/_part_/file",
        "www.bad-root/next/www.after-root.test/_part_/file",
        `www.${"a".repeat(64)}-www.after-long-label.test/_part_/file`,
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set([
        "http://www.after-email.test/_part_/file",
        "http://www.after-label.test/_part_/file",
        "http://www.after-long-label.test/_part_/file",
        "http://www.after-root.test/_part_/file",
      ]),
    );
  });

  it("does not invent www autolinks from plain domains, code, attributes, or disabled context", () => {
    const document = extractDocument(
      [
        "README.md example.com README.md/example.com example.xn--p1ai 1.2.3.4",
        "`www.example.com/inline-code`",
        "```text\nwww.example.com/fenced-code\n```",
        "<!-- www.example.com/comment -->",
        '<span title="www.example.com/attribute">text</span>',
        "<!-- markdown-link-check-disable -->\nwww.example.com/disabled\n<!-- markdown-link-check-enable -->",
        "ww<!-- markdown-link-check-disable -->removed<!-- markdown-link-check-enable -->w.example.com/joined",
      ].join("\n\n"),
    );
    expect(document.links).toEqual(new Set());
  });

  it("preserves existing destinations when www appears in labels, attributes, or email", () => {
    const document = extractDocument(
      [
        "[www.example.com/label](target.txt)",
        '<a href="www.example.com/relative">www.example.com/body</a>',
        "name@www.example.com www.name@example.com",
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set([
        "mailto:name@www.example.com",
        "mailto:www.name@example.com",
        "target.txt",
        "www.example.com/relative",
      ]),
    );
  });

  it("excludes escaped script data from links and anchors across MIME types", () => {
    const payload = JSON.stringify({
      template:
        "<!--<script></script><a href='missing-json.txt' id='json-ghost' name='json-name'>text</a>-->",
    });
    const document = extractDocument(
      [
        `<script type="application/json">${payload}</script>`,
        "<script><!--<script></script><a href='missing-js.txt' id='js-ghost'>text</a>--></script>",
        '<a href="known.txt" id="outside" name="outside-name">real</a>',
      ].join("\n\n"),
    );
    expect(document.links).toEqual(new Set(["known.txt"]));
    expect(document.anchors).toEqual(new Set(["outside", "outside-name"]));
  });

  it("ignores attributes on elements discarded by HTML tree construction", () => {
    const document = extractDocument(
      '<select><a href="missing.txt" id="ghost">text</a></select>\n\n<a href="known.txt" id="outside">real</a>',
    );
    expect(document.links).toEqual(new Set(["known.txt"]));
    expect(document.anchors).toEqual(new Set(["outside"]));
  });

  it("traverses template contents and foreign elements without promoting qualified attributes", () => {
    const document = extractDocument(
      [
        '<template><a href="outer.txt" id="outer">outer</a><template><a href="inner.txt" id="inner">inner</a></template></template>',
        '<svg><![CDATA[<a href="missing.txt" id="ghost">text</a>]]><a xlink:href="qualified.txt" xml:id="qualified-id"></a><a xlink:href="ignored.txt" href="svg.txt" id="svg">svg</a><template><a href="svg-template.txt">template</a></template><foreignObject><a href="html.txt" id="html">HTML</a></foreignObject></svg>',
      ].join("\n\n"),
    );
    expect(document.links).toEqual(
      new Set(["html.txt", "inner.txt", "outer.txt", "svg-template.txt", "svg.txt"]),
    );
    expect(document.anchors).toEqual(new Set(["html", "inner", "outer", "svg"]));
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

  it("filters disable-line markers on CR and LF physical lines without splitting Unicode separators", () => {
    const source = [
      '<!-- markdown-link-check-disable-line --><a href="start.txt">start</a>\r\n',
      '<a href="first.txt">first</a>\n',
      '<a href="before.txt">before</a>\u2028<!-- markdown-link-check-disable-line --><a href="middle.txt">middle</a>\u2029<!-- markdown-link-check-disable-line --><a href="after.txt">after</a>\r',
      '<a href="kept.txt">kept</a>\r\n',
      '<a href="last.txt">last</a>\n',
      '<a href="end.txt">end</a><!-- markdown-link-check-disable-line -->',
    ].join("");
    expect(extractDocument(source).links).toEqual(new Set(["first.txt", "kept.txt", "last.txt"]));
    expect(extractDocument(source, true).links).toEqual(
      new Set([
        "after.txt",
        "before.txt",
        "end.txt",
        "first.txt",
        "kept.txt",
        "last.txt",
        "middle.txt",
        "start.txt",
      ]),
    );
  });

  it("preserves original reference bindings and normalized labels across disabled definitions", () => {
    const source = [
      "[full][MiXeD   Label]",
      "[collapsed][]",
      "[shortcut]",
      "![image][PICTURE]",
      "",
      "<!-- markdown-link-check-disable -->",
      "[mixed label]: full.txt",
      "[collapsed]: collapsed.txt",
      "[shortcut]: shortcut.txt",
      "[picture]: picture.png",
      "[unused]: https://unused.invalid/ignored",
      "[disabled](disabled.txt)",
      "<!-- markdown-link-check-enable -->",
    ].join("\n");
    const active = ["full.txt", "collapsed.txt", "shortcut.txt", "picture.png"];
    expect(extractDocument(source).links).toEqual(new Set(active));
    expect(extractDocument(source, true).links).toEqual(new Set([...active, "disabled.txt"]));
  });

  it.each([
    ["absent", ""],
    ["present", "[other]: other.txt\n\n"],
  ])(
    "does not create reference bindings from filtered script context when original bindings are %s",
    async (_name, definitions) => {
      const source = [
        definitions,
        "<!-- markdown-link-check-disable -->",
        '<a href="missing.txt">disabled</a>',
        "",
        "<script>",
        "<!-- markdown-link-check-enable -->",
        "[ghost]: missing.txt",
        "</script>",
        "",
        "[visible][ghost]",
      ].join("\n");
      expect(extractDocument(source).links).toEqual(new Set());
      expect(await run(fixture(source).args)).toBe(0);
    },
  );

  it("keeps reference bindings isolated between documents", () => {
    expect(extractDocument("[visible][target]\n\n[target]: first.txt").links).toEqual(
      new Set(["first.txt"]),
    );
    expect(extractDocument("[visible][target]").links).toEqual(new Set());
    expect(extractDocument("[visible][target]\n\n[target]: second.txt").links).toEqual(
      new Set(["second.txt"]),
    );
  });
});

describe("Markdown link checking", () => {
  it("checks authenticated HTTP autolinks at their complete targets", async () => {
    const requested = new Set<string>();
    let authorization = "";
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      if (request.url === "/present" && request.headers.authorization !== authorization) {
        response.writeHead(401, { "www-authenticate": 'Basic realm="fixture"' }).end();
        return;
      }
      response.writeHead(request.url === "/" || request.url === "/present" ? 200 : 404).end();
    });
    const authority = new URL(base).host;
    const password = "x".repeat(64);
    authorization = `Basic ${Buffer.from(`${authority}${password}`).toString("base64")}`;
    // The userinfo prefix resolves to the live root if the URL is truncated.
    const missing = fixture(`http://${authority}:${password}@${authority}/missing`);
    expect(await run(missing.args)).toBe(1);
    expect(requested).toEqual(new Set(["/missing"]));

    requested.clear();
    const present = fixture(`http://${authority}${password}@${authority}/present`);
    expect(await run(present.args)).toBe(0);
    expect(requested).toEqual(new Set(["/present"]));
  });

  it("checks complete absolute and deep DNS targets instead of a live root", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === "/" ? 200 : 404).end();
    });
    const test = fixture(
      `https://example.test.:8080/missing?case=dot\n\nwww.${"a.".repeat(12)}example.test/missing?case=deep`,
      { replacementPatterns: [{ pattern: "^https?://[^/]+", replacement: base }] },
    );
    expect(await run(test.args)).toBe(1);
    expect(requested).toEqual(new Set(["/missing?case=deep", "/missing?case=dot"]));
  });

  it("checks a mapped IPv4 hostname at the intended origin", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === "/present" ? 200 : 404).end();
    });
    const target = `${base.replace("127.0.0.1", "１２７.０.０.１")}/present`;
    const test = fixture(`[target](${target})`, {
      replacementPatterns: [{ pattern: "^http://xn--[^/]+", replacement: `${base}/wrong-host` }],
    });
    expect(await run(test.args)).toBe(0);
    expect(requested).toEqual(new Set(["/present"]));
  });

  it.each([
    ["WWW emphasis", "www.example.test/_missing_/file", "/_missing_/file"],
    ["WWW terminal star", "www.example.test/_part_/missing*", "/_part_/missing*"],
    ["Unicode hostname", "https://example。com/missing", "/missing"],
    ["encoded hostname", "https://ex%61mple%2Ecom/missing", "/missing"],
    ["Unicode path", "https://example.com/missing。tail", "/missing%E3%80%82tail"],
    [
      "long HTTP",
      `https://length.test/${"x".repeat(10000)}/missing`,
      `/${"x".repeat(10000)}/missing`,
    ],
  ])("rejects the complete %s target instead of a live prefix", async (_name, source, path) => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === path ? 404 : 200).end();
    });
    const test = fixture(source, {
      replacementPatterns: [{ pattern: "^https?://[^/]+", replacement: base }],
    });
    expect(await run(test.args)).toBe(1);
    expect(requested).toEqual(new Set([path]));
  });

  it("accepts a complete long WWW target when that exact target is reachable", async () => {
    const path = `/${"x".repeat(10000)}/_present_/file`;
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === path ? 200 : 404).end();
    });
    const test = fixture(`www.length.test${path}`, {
      replacementPatterns: [{ pattern: "^https?://[^/]+", replacement: base }],
    });
    expect(await run(test.args)).toBe(0);
    expect(requested).toEqual(new Set([path]));
  });

  it("requests only real links outside escaped script data", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === "/outside" ? 200 : 404).end();
    });
    const payload = JSON.stringify({
      template: `<!--<script></script><a href='${base}/phantom'>text</a>-->`,
    });
    const test = fixture(
      `<script type="application/json">${payload}</script>\n\n<a href="${base}/outside">real</a>`,
    );
    expect(await run(test.args)).toBe(0);
    expect(requested).toEqual(new Set(["/outside"]));
  });

  it("checks www autolinks through the HTTP backend", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === "/present" ? 200 : 404).end();
    });
    const test = fixture("www.example.com/present", {
      replacementPatterns: [{ pattern: "^http://www\\.example\\.com/", replacement: `${base}/` }],
    });
    expect(await run(test.args)).toBe(0);
    expect(requested).toEqual(new Set(["/present"]));
  });

  it("rejects a missing local target reached through a www autolink", async () => {
    const test = fixture("www.example.com/missing.txt", {
      replacementPatterns: [{ pattern: "^http://www\\.example\\.com/", replacement: "./" }],
    });
    expect(await run(test.args)).toBe(1);
  });

  it.each([
    ["link", "[visible][target]"],
    ["image", "![visible][target]"],
  ])("checks the original reference destination for an active %s", async (_name, reference) => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === "/original" ? 404 : 200).end();
    });
    const test = fixture(
      [
        reference,
        "",
        "<!-- markdown-link-check-disable -->",
        `[target]: ${base}/original`,
        "<!-- markdown-link-check-enable -->",
        "",
        `[target]: ${base}/fallback`,
      ].join("\n"),
    );
    expect(await run(test.args)).toBe(1);
    expect(requested).toEqual(new Set(["/original"]));
  });

  it("checks a valid original reference instead of a broken fallback definition", async () => {
    const requested = new Set<string>();
    const base = await serve((request, response) => {
      requested.add(request.url ?? "");
      response.writeHead(request.url === "/original" ? 200 : 404).end();
    });
    const test = fixture(
      [
        "[visible][target]",
        "",
        "<!-- markdown-link-check-disable -->",
        `[target]: ${base}/original`,
        "<!-- markdown-link-check-enable -->",
        "",
        `[target]: ${base}/fallback`,
      ].join("\n"),
    );
    expect(await run(test.args)).toBe(0);
    expect(requested).toEqual(new Set(["/original"]));
  });

  const disabledSection =
    "<!-- markdown-link-check-disable -->removed<!-- markdown-link-check-enable -->";
  it.each([
    ["HTML comments", '<<!-- removed -->a id="fabricated"></a>'],
    ["inline code", '<`removed`a id="fabricated"></a>'],
    ["disabled sections", `<${disabledSection}a id="fabricated"></a>`],
    [
      "disabled script context",
      '<!-- markdown-link-check-disable -->\n<script>\n<!-- markdown-link-check-enable -->\n<a id="fabricated"></a>\n</script>',
    ],
    [
      "disabled fenced-code context",
      '<!-- markdown-link-check-disable -->\n```html\n<!-- markdown-link-check-enable -->\n<a id="fabricated"></a>\n```',
    ],
  ])("rejects fabricated anchors from %s", async (_name, source) => {
    const test = fixture(`[missing anchor](#fabricated)\n\n${source}`);
    expect(await run(test.args)).toBe(1);
  });

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
