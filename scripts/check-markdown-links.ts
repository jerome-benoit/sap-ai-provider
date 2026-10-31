import { Parser } from "htmlparser2";
import MarkdownIt from "markdown-it";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { z } from "zod";

const markdown = new MarkdownIt({ html: true, linkify: true });
// Rendering is parsed, never served or executed; the backend validates extracted protocols.
markdown.validateLink = () => true;
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
  anchors: string[];
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
 * Extract the former checker's HTML link attributes without its deprecated parser chain.
 * @param source - Markdown with optional inline HTML and checker disable directives
 * @param ignoreDisable - Check links inside otherwise disabled sections when true
 * @returns Deduplicated links and existing same-document anchors
 */
export function extractDocument(
  source: string,
  ignoreDisable = false,
): { anchors: Set<string>; links: Set<string> } {
  if (!ignoreDisable) {
    for (const pattern of [
      /(<!--[ \t]+markdown-link-check-disable[ \t]+-->[\S\s]*?<!--[ \t]+markdown-link-check-enable[ \t]+-->)/gm,
      /(<!--[ \t]+markdown-link-check-disable[ \t]+-->[\S\s]*(?!<!--[ \t]+markdown-link-check-enable[ \t]+-->))/gm,
      /(<!--[ \t]+markdown-link-check-disable-next-line[ \t]+-->\r?\n[^\r\n]*)/gm,
      /([^\r\n]*<!--[ \t]+markdown-link-check-disable-line[ \t]+-->[^\r\n]*)/gm,
    ])
      source = source.replace(pattern, "");
  }
  const links = new Set<string>();
  const parser = new Parser({
    onopentag(name, attributes) {
      const attribute = linkAttributes[name];
      const link = attribute ? attributes[attribute] : undefined;
      if (link) links.add(link);
    },
  });
  parser.end(markdown.render(source));
  return { anchors: documentAnchors(source), links };
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
                status = await checkDocumentLink(link, file, document.anchors, configuration);
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
 * Apply extraction-wrapper policy, delegating protocol, request, retry, and status behavior unchanged.
 * @param link - Extracted link
 * @param file - Originating Markdown file
 * @param anchors - Same-document anchor names
 * @param configuration - Existing checker configuration
 * @returns Printable status, with failures prefixed by FAIL
 */
async function checkDocumentLink(
  link: string,
  file: string,
  anchors: Set<string>,
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
  const baseUrl = pathToFileURL(dirname(resolve(file))).href;
  if (link.startsWith(baseUrl) && /^\/*#/.test(link.slice(baseUrl.length)))
    link = link.replace(/^[^#]+/, "");
  const result = await checkLink(link, {
    ...configuration,
    anchors: [...anchors].map((anchor) => `#${anchor}`),
    baseUrl,
    headers,
  });
  if (!result) throw new Error(`Checker returned no result for ${link}`);
  if (result.status === "alive") return "OK";
  if (link.startsWith("#")) return "FAIL Missing document anchor";
  return `FAIL HTTP ${String(result.statusCode)}${result.err instanceof Error ? ` ${result.err.message}` : ""}`;
}

/**
 * Preserve the former checker's ATX heading slugs and explicit HTML anchor semantics.
 * @param source - Markdown source after disable directives have been applied
 * @returns Anchor names in the same encoded form as extracted fragment links
 */
function documentAnchors(source: string): Set<string> {
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
  const anchors = new Set(duplicates.keys());
  const html = withoutCode
    .replace(/<!--[\S\s]+?-->/gm, "")
    .replace(/(?<!\\)`[\S\s]+?(?<!\\)`/gm, "");
  for (const pattern of [
    /<[^\s]+.*?id=["']([^"']*?)["'].*?>/gim,
    /<a.*?name=["']([^"']*?)["'].*?>/gim,
  ]) {
    for (const match of html.matchAll(pattern)) if (match[1] !== undefined) anchors.add(match[1]);
  }
  return anchors;
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
 * Remove fenced code using the former checker's anchor-extraction behavior.
 * @param source - Markdown source
 * @returns Source without fenced code blocks
 */
function removeCodeBlocks(source: string): string {
  return source.replace(/^[ \t]*(`{3,}|~{3,})[\S\s]+?^[ \t]*\1$/gm, "");
}

/**
 * Expand the former wrapper's supported configuration substitutions.
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
