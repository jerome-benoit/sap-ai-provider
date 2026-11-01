import MarkdownIt, { type Env, type Token } from "markdown-it";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { domainToASCII, fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { defaultTreeAdapter, type DefaultTreeAdapterTypes, parse } from "parse5";
import { z } from "zod";

declare module "markdown-it" {
  interface Env {
    /** Original bindings restored before filtered inline parsing. */
    readonly linkCheckOriginalEnvironment?: Env;
  }
}

const markdown = new MarkdownIt({ html: true, linkify: true });
const nativeNormalizeLink = markdown.normalizeLink.bind(markdown);
markdown.normalizeLink = (url) => {
  const match = /^(?:https?:)?\/\/[^/?#\\]*/i.exec(url);
  if (match) {
    const authority = match[0];
    const start = Math.max(authority.indexOf("//") + 2, authority.lastIndexOf("@") + 1);
    const colon = authority.indexOf(":", start);
    const end = colon < 0 ? authority.length : colon;
    const hostname = authority.slice(start, end);
    if (/\P{ASCII}/u.test(hostname)) {
      const ascii = domainToASCII(hostname);
      if (ascii) url = url.slice(0, start) + ascii + url.slice(end);
    }
  }
  return nativeNormalizeLink(url);
};
// The path extension precedes native alternatives and must end with "|".
const unicodePathPunctuation = new RegExp(
  String.raw`(?=[^\x00-\x7f])${markdown.linkify.re.src_P}|`,
);
markdown.linkify.re.get_path_extra = () => unicodePathPunctuation;
const unicodeDomainDot = String.raw`[\u3002\uff0e\uff61]`;
const domainDot = String.raw`(?:\.|${unicodeDomainDot})`;
const nativeRules = new MarkdownIt("zero");
const [nativeText] = nativeRules.inline.ruler.getRules("");
nativeRules.core.ruler.enableOnly(["linkify"]);
const [nativeLinkify] = nativeRules.core.ruler.getRules("");
if (nativeText === undefined || nativeLinkify === undefined)
  throw new Error("Markdown parser has no native text or linkification rule");
const wwwInlineTokens = new WeakSet<Token[]>();
interface AutolinkPatterns {
  dnsDot: RegExp;
  dot: RegExp;
  emailDomain: RegExp;
  hostEnd: RegExp;
  ipv6: RegExp;
  label: RegExp;
  prefix: RegExp;
  root: RegExp;
  suffix: RegExp;
}
let autolinkPatterns: AutolinkPatterns | undefined;
let rejectedWwwHostname: undefined | { end: number; start: number; text: string };

/**
 * Validate the final native root label of a multi-label hostname.
 * @param text - Linkifier input
 * @param start - Hostname offset
 * @param end - End of the complete hostname labels
 * @param patterns - Cached public linkifier patterns
 * @returns Whether the hostname has the native multi-label root form
 */
function hasDomainRoot(
  text: string,
  start: number,
  end: number,
  patterns: AutolinkPatterns,
): boolean {
  let dot = end - 1;
  let encoded = false;
  for (; dot >= start; dot--) {
    patterns.dot.lastIndex = dot;
    if (patterns.dot.test(text)) break;
    if (text.charCodeAt(dot) === 37) encoded = true;
  }
  if (dot < start) return false;
  if (encoded) {
    const ascii = domainToASCII(text.slice(dot + 1, end));
    if (ascii) {
      const rootEnd = ascii.endsWith(".") ? ascii.length - 1 : ascii.length;
      patterns.root.lastIndex = ascii.lastIndexOf(".", rootEnd - 1) + 1;
      return patterns.root.test(ascii) && patterns.root.lastIndex === rootEnd;
    }
  }
  patterns.root.lastIndex = dot + 1;
  return patterns.root.test(text) && patterns.root.lastIndex === end;
}

/**
 * Match complete hostname labels without backtracking across label boundaries.
 * @param text - Linkifier input
 * @param start - Hostname offset
 * @param patterns - Cached public linkifier patterns
 * @returns End offset, or zero when no hostname matches
 */
function matchHostname(text: string, start: number, patterns: AutolinkPatterns): number {
  let cursor = start;
  let labels = 0;
  for (;;) {
    patterns.label.lastIndex = cursor;
    if (!patterns.label.test(text)) {
      if (labels === 0) return 0;
      cursor--;
      break;
    }
    labels++;
    cursor = patterns.label.lastIndex;
    patterns.dot.lastIndex = cursor;
    if (!patterns.dot.test(text)) break;
    cursor = patterns.dot.lastIndex;
  }
  return cursor;
}

/**
 * Reuse a rejected hostname span across nested WWW candidates.
 * @param text - Exact bounded validator input
 * @param start - Start of the rejected hostname
 * @param end - Exclusive end of complete labels, before any port or path
 * @returns Zero to reject the candidate
 */
function rejectWwwHostname(text: string, start: number, end: number): 0 {
  rejectedWwwHostname = { end, start, text };
  return 0;
}

/**
 * Validate HTTP(S) and WWW autolinks using complete hostname labels.
 * @param text - Untruncated linkifier input within its parsing boundary
 * @param position - Offset immediately after the schema prefix
 * @param www - Whether to require the native WWW hostname form
 * @returns Matched length after the schema prefix, or zero
 */
function validateAutolink(text: string, position: number, www: boolean): number {
  if (!autolinkPatterns) {
    const rules = markdown.linkify.re;
    const letter = rules.get_pseudo_letter().source;
    const escape = String.raw`%[\da-f]{2}`;
    const atom = `(?:${escape}|${letter})`;
    const encodedLabel = `(?=(?:${letter}|-)*${escape})${atom}(?:(?:${atom}|-)*${atom})?`;
    const boundary = `(?!${letter}|-|%)`;
    autolinkPatterns = {
      dnsDot: new RegExp(String.raw`(?:\.(?=[/?#]|:\d)|${unicodeDomainDot})`, "y"),
      dot: new RegExp(domainDot, "y"),
      emailDomain: new RegExp(
        `(?<=${rules.get_mail_name().source}@(?:${atom}|${domainDot}|-){0,${String(rules.opts.maxLength)}})`,
        "iy",
      ),
      hostEnd: new RegExp(rules.get_host_terminator().source, "iy"),
      ipv6: new RegExp(rules.get_ipv6_url_host().source, "iy"),
      label: new RegExp(`(?:${encodedLabel}|${rules.get_domain().source})${boundary}`, "iy"),
      prefix: new RegExp(
        String.raw`//(?:(?:(?!${rules.src_ZCc}|${rules.get_text_separators().source}|[/?#]).)*@)?`,
        "iy",
      ),
      root: new RegExp(`(?:${encodedLabel}|${rules.get_domain_root().source})${boundary}`, "iy"),
      suffix: new RegExp(
        rules.get_port().source + rules.get_host_terminator().source + rules.get_path().source,
        "iy",
      ),
    };
  }
  const patterns = autolinkPatterns;
  let cursor = www ? position - 4 : position;
  if (www) {
    if (
      rejectedWwwHostname?.text === text &&
      cursor >= rejectedWwwHostname.start &&
      cursor < rejectedWwwHostname.end
    )
      return 0;
    // Email domains must not become WWW links when fuzzy email recognition stops early.
    patterns.emailDomain.lastIndex = cursor;
    if (patterns.emailDomain.test(text)) {
      const hostnameStart = text.lastIndexOf("@", cursor - 1) + 1;
      const hostnameEnd = matchHostname(text, hostnameStart, patterns);
      patterns.hostEnd.lastIndex = hostnameEnd;
      if (
        hostnameEnd > cursor &&
        hasDomainRoot(text, hostnameStart, hostnameEnd, patterns) &&
        patterns.hostEnd.test(text)
      )
        return rejectWwwHostname(text, hostnameStart, hostnameEnd);
    }
  } else {
    // Separate prefix and target matching to prevent fallback to a partial authority.
    patterns.prefix.lastIndex = cursor;
    if (!patterns.prefix.test(text)) return 0;
    cursor = patterns.prefix.lastIndex;
  }
  const hostnameStart = cursor;
  if (text[cursor] === "[") {
    patterns.ipv6.lastIndex = cursor;
    if (!patterns.ipv6.test(text)) return 0;
    cursor = patterns.ipv6.lastIndex;
  } else {
    cursor = matchHostname(text, cursor, patterns);
    if (cursor === 0) return 0;
    if (www && !hasDomainRoot(text, hostnameStart, cursor, patterns))
      return rejectWwwHostname(text, hostnameStart, cursor);
  }
  const hostnameEnd = cursor;
  if (text[hostnameStart] !== "[") {
    patterns.dnsDot.lastIndex = cursor;
    if (patterns.dnsDot.test(text)) cursor = patterns.dnsDot.lastIndex;
  }
  patterns.suffix.lastIndex = cursor;
  if (!patterns.suffix.test(text))
    return www ? rejectWwwHostname(text, hostnameStart, hostnameEnd) : 0;
  const end = patterns.suffix.lastIndex;
  if (www && text[end] === "@") {
    // A bare WWW hostname does not introduce userinfo.
    patterns.label.lastIndex = end + 1;
    if (patterns.label.test(text)) return 0;
  }
  return end - position;
}

const httpAutolink = {
  validate(text: string, position: number) {
    return validateAutolink(text, position, false);
  },
};
markdown.linkify.add("http:", httpAutolink);
markdown.linkify.add("https:", httpAutolink);
// Recognize www. autolinks without treating filenames or bare domains as URLs.
markdown.linkify.add("www.", {
  normalize(match) {
    match.url = `http://${match.url}`;
  },
  validate(text, position) {
    return validateAutolink(text, position, true);
  },
});
const wwwSearch = new RegExp(markdown.linkify.re.get_schema_search());

// Keep URL-internal syntax in text; native rules retain delimiter and email precedence.
markdown.inline.ruler.at("text", (state, silent) => {
  if (silent || state.linkLevel > 0) return nativeText(state, silent);
  const start = state.pos;
  if (!nativeText(state, true)) return false;
  const runEnd = state.pos;
  state.pos = start;
  const pendingLength = state.pending.length;
  const contextLength = Math.min(1, pendingLength);
  const text = state.pending.slice(pendingLength - contextLength) + state.src.slice(start, runEnd);
  wwwSearch.lastIndex = 0;
  for (let match = wwwSearch.exec(text); match !== null; match = wwwSearch.exec(text)) {
    if (match[2]?.toLowerCase() !== "www.") continue;
    const offset = start - contextLength + wwwSearch.lastIndex - 4;
    if (offset < start) continue;
    if (offset === start && pendingLength === 0 && state.tokens.at(-1)?.type === "text_special")
      continue;
    wwwInlineTokens.add(state.tokens);
    const source = state.posMax === state.src.length ? state.src : state.src.slice(0, state.posMax);
    const length = markdown.linkify.testSchemaAt(source, "www.", offset + 4);
    if (length === 0) continue;
    let end = offset + 4 + length;
    // Retain the preceding boundary when skipping an accepted destination.
    wwwSearch.lastIndex = end - start + contextLength - 1;
    while (end > offset) {
      const marker = state.src.charCodeAt(end - 1);
      if (marker !== 42 && marker !== 95 && marker !== 126) break;
      end--;
    }
    if (end <= runEnd) continue;
    state.pending += state.src.slice(start, end);
    state.pos = end;
    return true;
  }
  return nativeText(state, false);
});

// Pretest affected blocks on their parsed text, without changing native per-token filtering.
markdown.core.ruler.at("linkify", (state) => {
  const originals = new Map<Token, string>();
  for (const token of state.tokens) {
    if (token.type !== "inline" || !token.children || !wwwInlineTokens.has(token.children))
      continue;
    const text = token.children
      .filter((child) => child.type === "text")
      .map((child) => child.content)
      .join("\n");
    if (text !== token.content) {
      originals.set(token, token.content);
      token.content = text;
    }
  }
  try {
    nativeLinkify(state);
  } finally {
    for (const [token, content] of originals) token.content = content;
  }
});
// Rendering is parsed, never served or executed; the backend validates extracted protocols.
markdown.validateLink = () => true;
markdown.core.ruler.after("block", "link_check_original_references", (state) => {
  const original = state.env.linkCheckOriginalEnvironment;
  if (original !== undefined) state.env.references = original.references;
});
const configurationSchema = z.looseObject({
  $schema: z.string().optional(),
  aliveStatusCodes: z.array(z.number().int()).optional(),
  fallbackRetryDelay: z.string().optional(),
  httpHeaders: z
    .array(
      z.object({ headers: z.record(z.string(), z.string()).optional(), urls: z.array(z.string()) }),
    )
    .optional(),
  ignoreDisable: z.boolean().optional(),
  ignorePatterns: z.array(z.object({ pattern: z.string() })).optional(),
  replacementPatterns: z
    .array(
      z.object({ global: z.boolean().optional(), pattern: z.string(), replacement: z.string() }),
    )
    .optional(),
  retryCount: z.number().int().optional(),
  retryOn429: z.boolean().optional(),
  timeout: z.string().optional(),
});
type Configuration = z.infer<typeof configurationSchema>;

interface LinkCheckOptions extends Configuration {
  anchors: readonly string[];
  baseUrl: string;
  headers: Record<string, string>;
}

interface LinkCheckResult {
  err: unknown;
  link: string;
  status: "alive" | "dead";
  statusCode: number;
}

// link-check ships no declarations and has no DefinitelyTyped package.
const linkCheck = createRequire(import.meta.url)("link-check") as (
  link: string,
  options: LinkCheckOptions,
  callback: (error: Error | null, result: LinkCheckResult | null) => void,
) => void;
const checkLink = promisify(linkCheck);

const linkAttributes: Record<string, string> = {
  a: "href",
  area: "href",
  audio: "src",
  embed: "src",
  iframe: "src",
  img: "src",
  input: "src",
  javascript: "src",
  link: "href",
  source: "src",
  track: "src",
  video: "src",
};

/**
 * Collect Markdown and inline HTML link destinations and same-document anchors.
 * @param source - Markdown with optional inline HTML and checker disable directives
 * @param ignoreDisable - Check links inside otherwise disabled sections when true
 * @returns Deduplicated links and existing same-document anchors
 */
export function extractDocument(
  source: string,
  ignoreDisable = false,
): { anchors: Set<string>; links: Set<string> } {
  const maxLength = Math.max(1, source.length);
  if (markdown.linkify.re.opts.maxLength !== maxLength) {
    markdown.linkify.set({ maxLength });
    autolinkPatterns = undefined;
  }
  const originalSource = source;
  if (!ignoreDisable) {
    for (const pattern of [
      /(<!--[ \t]+markdown-link-check-disable[ \t]+-->[\S\s]*?<!--[ \t]+markdown-link-check-enable[ \t]+-->)/gm,
      /(<!--[ \t]+markdown-link-check-disable[ \t]+-->[\S\s]*(?!<!--[ \t]+markdown-link-check-enable[ \t]+-->))/gm,
      /(<!--[ \t]+markdown-link-check-disable-next-line[ \t]+-->\r?\n[^\r\n]*)/gm,
      /(?<![^\r\n])[^\r\n]*<!--[ \t]+markdown-link-check-disable-line[ \t]+-->[^\r\n]*/g,
    ])
      source = source.replace(pattern, "");
  }
  const originalEnvironment: Env = {};
  const original = parseHTMLDocument(originalSource, originalEnvironment);
  const document =
    source === originalSource
      ? original
      : parseHTMLDocument(source, {
          linkCheckOriginalEnvironment: originalEnvironment,
        });
  if (source !== originalSource) {
    // Filtering must not invent HTML attributes by changing markup or parser context.
    for (const link of document.links) if (!original.links.has(link)) document.links.delete(link);
    for (const anchor of document.anchors)
      if (!original.anchors.has(anchor)) document.anchors.delete(anchor);
  }
  for (const anchor of headingAnchors(source)) document.anchors.add(anchor);
  return document;
}

/**
 * Validate selected Markdown files, or recursively check repository Markdown by default.
 * @param args - Optional Markdown paths and --config <path>
 * @returns Nonzero for broken links, invalid configuration, or unreadable inputs
 */
export async function run(args: string[]): Promise<number> {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      args,
      options: { config: { type: "string" } },
    });
    const configuration = configurationSchema.parse(
      JSON.parse(readFileSync(values.config ?? ".markdown-links.json", "utf8")),
    );
    const files = positionals.length > 0 ? positionals : markdownFiles(".").sort();
    let failed = false;
    let linkCount = 0;
    for (const file of files) {
      try {
        const document = extractDocument(readFileSync(file, "utf8"), configuration.ignoreDisable);
        const links = [...document.links];
        if (links.length === 0) continue;
        const baseUrl = pathToFileURL(dirname(resolve(file))).href;
        const anchors = Array.from(document.anchors, (anchor) => `#${anchor}`);
        const messages = new Array<string>(links.length);
        linkCount += links.length;
        let next = 0;
        await Promise.all(
          Array.from({ length: Math.min(2, links.length) }, async () => {
            for (;;) {
              const index = next++;
              const link = links[index];
              if (link === undefined) return;
              let status: string;
              try {
                status = await checkDocumentLink(link, baseUrl, anchors, configuration);
              } catch (error) {
                status = `FAIL ${error instanceof Error ? error.message : String(error)}`;
              }
              if (status.startsWith("FAIL")) failed = true;
              messages[index] = `${status} ${file}: ${link}`;
            }
          }),
        );
        for (const message of messages) console.log(message);
      } catch (error) {
        console.error(`FAIL ${file}: ${error instanceof Error ? error.message : String(error)}`);
        failed = true;
      }
    }
    console.log(`Checked ${String(files.length)} Markdown file(s), ${String(linkCount)} link(s)`);
    return failed ? 1 : 0;
  } catch (error) {
    console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/**
 * Apply link policy and delegate protocol, request, retry, and status handling to link-check.
 * @param link - Extracted link
 * @param baseUrl - Originating document directory URL, computed once for its links
 * @param anchors - Prefixed same-document anchors shared by this document's checks
 * @param configuration - Existing checker configuration
 * @returns Printable status, with failures prefixed by FAIL
 */
async function checkDocumentLink(
  link: string,
  baseUrl: string,
  anchors: readonly string[],
  configuration: Configuration,
): Promise<string> {
  if (configuration.ignorePatterns?.some(({ pattern }) => new RegExp(pattern).test(link)))
    return "SKIP";
  for (const replacement of configuration.replacementPatterns ?? []) {
    link = link.replace(
      new RegExp(replacement.pattern, replacement.global ? "g" : ""),
      substitute(replacement.replacement),
    );
  }
  const headers: Record<string, string> = {};
  for (const entry of configuration.httpHeaders ?? []) {
    if (entry.urls.some((url) => link.startsWith(url))) {
      for (const [name, value] of Object.entries(entry.headers ?? {}))
        headers[name] = substitute(value);
    }
  }
  if (link.startsWith(baseUrl) && /^\/*#/.test(link.slice(baseUrl.length)))
    link = link.replace(/^[^#]+/, "");
  const result = await checkLink(link, {
    ...configuration,
    anchors,
    baseUrl,
    headers,
  });
  if (!result) throw new Error(`Checker returned no result for ${link}`);
  if (result.status === "alive") return "OK";
  if (link.startsWith("#")) return "FAIL Missing document anchor";
  return `FAIL HTTP ${String(result.statusCode)}${result.err instanceof Error ? ` ${result.err.message}` : ""}`;
}

/**
 * Compute legacy URI-encoded ATX anchor names.
 * @param source - Markdown source after disable directives have been applied
 * @returns Heading fragment names in the legacy encoded form
 */
function headingAnchors(source: string): Set<string> {
  const withoutCode = removeCodeBlocks(source);
  const headings = (withoutCode.match(/^#+ .*$/gm) ?? []).map((heading) =>
    encodeURIComponent(
      heading
        .replace(/\[(.+)\]\(((?:\.?\/|https?:\/\/|#)[\w\d./?=#-]+)\)/, "$1")
        .toLowerCase()
        .replace(/^#+\s*/, "")
        .replace(/[^\p{L}\p{Nd}\p{Nl}\s_\-`]/gu, "")
        .replace(/`/gu, "")
        .replace(/\s/gu, "-"),
    ),
  );
  const duplicates = new Map<string, number>();
  for (let heading of headings) {
    const count = duplicates.get(heading);
    if (count !== undefined) {
      duplicates.set(heading, count + 1);
      heading = `${heading}-${String(count + 1)}`;
    }
    duplicates.set(heading, 0);
  }
  return new Set(duplicates.keys());
}

/**
 * Collect Markdown files portably without following directory symlinks.
 * @param directory - Directory to traverse
 * @returns Markdown paths, including hidden directories but excluding installed dependencies
 */
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : markdownFiles(path);
    return (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md") ? [path] : [];
  });
}

/**
 * Collect real HTML link and anchor attributes from rendered Markdown.
 * @param source - Markdown source without HTML sanitization or code stripping
 * @param environment - Document-local bindings and optional original-rendering context
 * @returns Deduplicated HTML attribute values, excluding comments and code text
 */
function parseHTMLDocument(
  source: string,
  environment: Env,
): { anchors: Set<string>; links: Set<string> } {
  const links = new Set<string>();
  const anchors = new Set<string>();
  let html: string;
  rejectedWwwHostname = undefined;
  try {
    html = markdown.render(source, environment);
  } finally {
    rejectedWwwHostname = undefined;
  }
  const nodes: DefaultTreeAdapterTypes.Node[] = [parse(html)];
  for (let node = nodes.pop(); node !== undefined; node = nodes.pop()) {
    if ("childNodes" in node) {
      const children = defaultTreeAdapter.getChildNodes(node);
      for (let index = children.length - 1; index >= 0; index--) {
        const child = children[index];
        if (child !== undefined) nodes.push(child);
      }
    }
    if ("content" in node) nodes.push(defaultTreeAdapter.getTemplateContent(node));
    if (!defaultTreeAdapter.isElementNode(node)) continue;
    const name = defaultTreeAdapter.getTagName(node);
    const linkAttribute = linkAttributes[name];
    for (const attribute of defaultTreeAdapter.getAttrList(node)) {
      if (attribute.namespace !== undefined || attribute.prefix !== undefined) continue;
      if (attribute.name === linkAttribute && attribute.value) links.add(attribute.value);
      if (attribute.name === "id" || (name === "a" && attribute.name === "name"))
        anchors.add(attribute.value);
    }
  }
  return { anchors, links };
}

/**
 * Remove fenced blocks before legacy heading-anchor extraction.
 * @param source - Markdown source
 * @returns Source without fenced code blocks
 */
function removeCodeBlocks(source: string): string {
  return source.replace(/^[ \t]*(`{3,}|~{3,})[\S\s]+?^[ \t]*\1$/gm, "");
}

/**
 * Expand repository-base and environment placeholders in configuration values.
 * @param value - Replacement or header value
 * @returns Value with repository-base and environment substitutions applied
 */
function substitute(value: string): string {
  return value
    .replace("{{BASEURL}}", pathToFileURL(process.cwd()).href)
    .replace(
      /\{\{env\.([a-zA-Z0-9\-_]+)\}\}/g,
      (_match: string, name: string) => process.env[name] ?? "",
    );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run(process.argv.slice(2));
}
