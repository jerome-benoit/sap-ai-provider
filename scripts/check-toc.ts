/**
 * ToC (Table of Contents) Validation Script
 *
 * Validates that ToCs in Markdown files are synchronized with their headings.
 * @module scripts/check-toc
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ============================================================================
// Types
// ============================================================================

/** Heading extracted from markdown content */
export interface Heading {
  baseSlug: string;
  level: number;
  slug: string;
  text: string;
}

/** Node in a heading tree (parent-child hierarchy based on heading levels) */
export interface HeadingNode {
  children: HeadingNode[];
  heading: Heading;
}

/** ToC entry extracted from markdown content */
export interface TocEntry {
  slug: string;
  text: string;
}

/** Result of ToC validation for a single file */
export interface ValidationResult {
  errors: string[];
  skipped: boolean;
  valid: boolean;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Build a heading tree from a flat list of headings using a stack-based algorithm.
 * Headings are nested based on their level: an h3 after an h2 becomes a child of that h2.
 * @param headings - Flat array of headings in document order
 * @returns Forest of heading nodes (roots are the highest-level headings)
 */
export function buildHeadingTree(headings: Heading[]): HeadingNode[] {
  const roots: HeadingNode[] = [];
  const stack: HeadingNode[] = [];

  for (const heading of headings) {
    const node: HeadingNode = { children: [], heading };

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined || top.heading.level < heading.level) break;
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1] : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    stack.push(node);
  }

  return roots;
}

/**
 * Extract headings from markdown content, excluding code blocks.
 * Handles duplicate headings with GitHub-style suffixes (-1, -2, etc.).
 * @param content - Markdown file content
 * @returns Array of extracted headings with slugs
 */
export function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = [];
  const slugCounts = new Map<string, number>();
  let inCodeBlock = false;

  for (const line of content.split("\n")) {
    if (/^(`{3,}|~{3,})/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) continue;

    const match = /^(#{1,6})\s+(.+)$/.exec(line);
    if (match?.[1] && match[2]) {
      const level = match[1].length;
      const rawText = match[2];

      const text = rawText
        .replaceAll(/\*\*([^*]+)\*\*/g, "$1")
        .replaceAll(/\*([^*]+)\*/g, "$1")
        .replaceAll(/__([^_]+)__/g, "$1")
        .replaceAll(/_([^_]+)_/g, "$1")
        .replaceAll(/`([^`]+)`/g, "$1")
        .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();

      const baseSlug = slugify(text);
      const count = slugCounts.get(baseSlug) ?? 0;
      slugCounts.set(baseSlug, count + 1);

      const slug = count === 0 ? baseSlug : `${baseSlug}-${String(count)}`;

      headings.push({ baseSlug, level, slug, text });
    }
  }

  return headings;
}

/**
 * Extract ToC entries from markdown content (case-insensitive).
 * @param content - Markdown file content
 * @returns Array of ToC entries
 */
export function extractTocEntries(content: string): TocEntry[] {
  const entries: TocEntry[] = [];

  const tocMatch = /##\s+Table of Contents\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i.exec(content);
  if (!tocMatch?.[1]) return entries;

  const tocSection = tocMatch[1];
  const linkRegex = /\[([^\]]+)\]\(#([^)]+)\)/g;
  let match: null | RegExpExecArray;
  while ((match = linkRegex.exec(tocSection)) !== null) {
    const text = match[1];
    const slug = match[2];
    if (text && slug) {
      entries.push({ slug, text });
    }
  }

  return entries;
}

/**
 * Extract slugs of ToC entries that have indented children in the ToC.
 * A "parent" is any entry immediately followed by a more-indented entry.
 * @param content - Markdown file content
 * @returns Set of slugs that act as parents in the ToC hierarchy
 */
export function extractTocParentSlugs(content: string): Set<string> {
  const parents = new Set<string>();

  const tocMatch = /##\s+Table of Contents\s*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i.exec(content);
  if (!tocMatch?.[1]) return parents;

  const tocSection = tocMatch[1];
  const lineRegex = /^(\s*)-\s+\[([^\]]+)\]\(#([^)]+)\)/gm;
  const entries: { indent: number; slug: string }[] = [];

  let match: null | RegExpExecArray;
  while ((match = lineRegex.exec(tocSection)) !== null) {
    const indent = match[1]?.length ?? 0;
    const slug = match[3];
    if (slug) {
      entries.push({ indent, slug });
    }
  }

  for (const [i, current] of entries.entries()) {
    const next = entries[i + 1];
    if (next && next.indent > current.indent) {
      parents.add(current.slug);
    }
  }

  return parents;
}

/**
 * Detect headings with inconsistent sibling TOC coverage.
 * Rule: if a parent heading has explicit children in the TOC (indented entries),
 * all siblings at that level under the same parent must also be listed.
 * Only checks h3+ (h2 mandatory coverage is handled separately).
 * @param roots - Heading tree from {@link buildHeadingTree}
 * @param tocSlugs - Set of slugs present in the TOC
 * @param tocParentSlugs - Set of slugs that have indented children in the TOC
 * @returns Array of error messages for missing siblings
 */
export function findInconsistentSiblings(
  roots: HeadingNode[],
  tocSlugs: Set<string>,
  tocParentSlugs: Set<string>,
): string[] {
  const errors: string[] = [];

  /**
   * @param heading - Heading to check
   * @returns Whether the heading's slug exists in the TOC
   */
  function isInToc(heading: Heading): boolean {
    return tocSlugs.has(heading.slug) || tocSlugs.has(heading.baseSlug);
  }

  /**
   * @param heading - Heading to check
   * @returns Whether the heading acts as a parent in the TOC (has indented children)
   */
  function isTocParent(heading: Heading): boolean {
    return tocParentSlugs.has(heading.slug) || tocParentSlugs.has(heading.baseSlug);
  }

  /**
   * @param parent - Parent heading node (undefined for roots)
   * @param children - Child heading nodes to check
   */
  function check(parent: HeadingNode | undefined, children: HeadingNode[]): void {
    if (children.length === 0) return;

    // Only check siblings if the parent has explicit children in the TOC
    if (parent && !isTocParent(parent.heading)) {
      for (const child of children) {
        check(child, child.children);
      }
      return;
    }

    const byLevel = new Map<number, HeadingNode[]>();
    for (const child of children) {
      const level = child.heading.level;
      if (level <= 2) continue;
      const group = byLevel.get(level);
      if (group) {
        group.push(child);
      } else {
        byLevel.set(level, [child]);
      }
    }

    for (const [level, siblings] of byLevel) {
      const listed = siblings.filter((s) => isInToc(s.heading));
      const missing = siblings.filter((s) => !isInToc(s.heading));

      if (listed.length > 0 && missing.length > 0) {
        const parentText = parent?.heading.text ?? "document root";
        for (const m of missing) {
          errors.push(
            `Heading "${m.heading.text}" (h${String(level)}) not in ToC, ` +
              `but sibling(s) under "${parentText}" are listed`,
          );
        }
      }
    }

    for (const child of children) {
      check(child, child.children);
    }
  }

  check(undefined, roots);
  return errors;
}

/**
 * Run ToC validation on specified files or all .md files in current directory.
 * @param args - File paths to validate
 * @returns Exit code (0 for success, 1 for errors)
 */
export function run(args: string[]): number {
  let files = args;

  if (files.length === 0) {
    files = readdirSync(".")
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(".", f));
  }

  let hasErrors = false;
  let checkedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    try {
      const result = validateToc(file);

      if (result.skipped) {
        skippedCount++;
        continue;
      }

      checkedCount++;

      if (!result.valid) {
        hasErrors = true;
        console.error(`\x1b[31m✗ ${file}\x1b[0m`);
        for (const error of result.errors) {
          console.error(`  - ${error}`);
        }
      } else {
        console.log(`\x1b[32m✓ ${file}\x1b[0m`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\x1b[31m✗ ${file}: ${message}\x1b[0m`);
      hasErrors = true;
    }
  }

  console.log(
    `\nChecked ${String(checkedCount)} file(s), skipped ${String(skippedCount)} (no ToC)`,
  );

  if (hasErrors) {
    console.error("\n\x1b[31mToC validation failed\x1b[0m");
    return 1;
  } else {
    console.log("\x1b[32mAll ToCs are valid\x1b[0m");
    return 0;
  }
}

/**
 * Generate GitHub-compatible slug from heading text.
 * Note: Does NOT collapse multiple hyphens from removed special chars.
 * @param text - Heading text to slugify
 * @returns GitHub-compatible anchor slug
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/\s+/g, "-")
    .replaceAll(/[^\w-]/g, "")
    .replaceAll(/^-+|-+$/g, "");
}

/**
 * Validate ToC against actual headings in a file.
 * @param filePath - Path to the markdown file
 * @returns Validation result
 */
export function validateToc(filePath: string): ValidationResult {
  const content = readFileSync(filePath, "utf-8");
  return validateTocContent(content);
}

/**
 * Validate ToC against actual headings from content string.
 * @param content - Markdown content to validate
 * @returns Validation result
 */
export function validateTocContent(content: string): ValidationResult {
  const errors: string[] = [];

  const tocEntries = extractTocEntries(content);
  if (tocEntries.length === 0) {
    return { errors: [], skipped: true, valid: true };
  }

  const headings = extractHeadings(content);

  const validSlugs = new Set<string>();
  for (const h of headings) {
    if (h.text.toLowerCase() !== "table of contents") {
      validSlugs.add(h.slug);
      validSlugs.add(h.baseSlug);
    }
  }

  for (const entry of tocEntries) {
    if (!validSlugs.has(entry.slug)) {
      const similar = [...validSlugs].find(
        (s) => s.includes(entry.slug.replace(/-\d+$/, "")) || entry.slug.includes(s),
      );
      if (similar) {
        errors.push(`ToC link "#${entry.slug}" not found. Did you mean "#${similar}"?`);
      } else {
        errors.push(`ToC link "#${entry.slug}" (${entry.text}) has no matching heading`);
      }
    }
  }

  const tocSlugs = new Set(tocEntries.map((e) => e.slug));
  for (const heading of headings) {
    if (
      heading.level === 2 &&
      heading.text.toLowerCase() !== "table of contents" &&
      !tocSlugs.has(heading.slug) &&
      !tocSlugs.has(heading.baseSlug)
    ) {
      errors.push(`Heading "${heading.text}" (h2) is not in ToC`);
    }
  }

  // Sibling consistency: if some h3+ siblings are in the TOC, all must be
  const contentHeadings = headings.filter((h) => h.text.toLowerCase() !== "table of contents");
  const tree = buildHeadingTree(contentHeadings);
  const tocParentSlugs = extractTocParentSlugs(content);
  errors.push(...findInconsistentSiblings(tree, tocSlugs, tocParentSlugs));

  return { errors, skipped: false, valid: errors.length === 0 };
}

// ============================================================================
// CLI Entry Point
// ============================================================================

// Run CLI if executed directly
const isMainModule =
  typeof process !== "undefined" &&
  process.argv[1] &&
  (process.argv[1].endsWith("check-toc.ts") || process.argv[1].endsWith("check-toc.js"));

if (isMainModule) {
  const exitCode = run(process.argv.slice(2));
  process.exit(exitCode);
}
