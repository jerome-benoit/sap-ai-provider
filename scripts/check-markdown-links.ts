import { Parser } from "htmlparser2";
import MarkdownIt, { type Env } from "markdown-it";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";

declare module "markdown-it" {
  interface Env {
    /** Original bindings restored before filtered inline parsing. */
    readonly linkCheckOriginalEnvironment?: Env;
  }
}

const markdown = new MarkdownIt({ html: true, linkify: true });
// Separate prefix and target matching to prevent fallback to a partial authority.
let httpPatterns: undefined | { prefix: RegExp; target: RegExp };
const httpAutolink = {
  validate(text: string, position: number) {
    const rules = markdown.linkify.re;
    const patterns = (httpPatterns ??= {
      prefix: new RegExp(
        String.raw`//(?:(?:(?!${rules.src_ZCc}|${rules.get_text_separators().source}|[/?#]).)*@)?`,
        "iy",
      ),
      target: new RegExp(rules.get_url_host_port().source + rules.get_path().source, "iy"),
    });
    patterns.prefix.lastIndex = position;
    if (!patterns.prefix.test(text)) return 0;
    patterns.target.lastIndex = patterns.prefix.lastIndex;
    return patterns.target.test(text) ? patterns.target.lastIndex - position : 0;
  },
};
markdown.linkify.add("http:", httpAutolink);
markdown.linkify.add("https:", httpAutolink);
// Recognize www. autolinks without treating filenames or bare domains as URLs.
markdown.linkify.add("www.", {
  normalize(match) {
    match.url = `http://${match.url}`;
  },
  validate(text, position, self) {
    const pattern = self.re.get_relative_proto_validator();
    // Validate the full host; the linkifier has already counted the "www." prefix.
    pattern.lastIndex = position - 4;
    return pattern.test(text) ? pattern.lastIndex - position : 0;
  },
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
  const originalSource = source;
  if (!ignoreDisable) {
    for (const pattern of [
      /(<!--[ \t]+markdown-link-check-disable[ \t]+-->[\S\s]*?<!--[ \t]+markdown-link-check-enable[ \t]+-->)/gm,
      /(<!--[ \t]+markdown-link-check-disable[ \t]+-->[\S\s]*(?!<!--[ \t]+markdown-link-check-enable[ \t]+-->))/gm,
      /(<!--[ \t]+markdown-link-check-disable-next-line[ \t]+-->\r?\n[^\r\n]*)/gm,
      /([^\r\n]*<!--[ \t]+markdown-link-check-disable-line[ \t]+-->[^\r\n]*)/gm,
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
  const parser = new Parser({
    onopentag(name, attributes) {
      const attribute = linkAttributes[name];
      const link = attribute ? attributes[attribute] : undefined;
      if (link) links.add(link);
      if (attributes.id !== undefined) anchors.add(attributes.id);
      if (name === "a" && attributes.name !== undefined) anchors.add(attributes.name);
    },
  });
  parser.end(markdown.render(source, environment));
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
