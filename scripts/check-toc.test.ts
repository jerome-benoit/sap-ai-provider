/**
 * Unit tests for ToC (Table of Contents) Validation Script
 *
 * Tests the core functions for extracting headings, ToC entries,
 * generating slugs, and validating ToC synchronization.
 */

import { describe, expect, it } from "vitest";

import {
  buildHeadingTree,
  extractHeadings,
  extractTocEntries,
  extractTocParentSlugs,
  findInconsistentSiblings,
  slugify,
  validateTocContent,
} from "./check-toc";

// ============================================================================
// slugify() Tests
// ============================================================================

describe("slugify", () => {
  describe("basic transformations", () => {
    it("should convert simple text to lowercase slug", () => {
      expect(slugify("Hello World")).toBe("hello-world");
    });

    it("should handle single word", () => {
      expect(slugify("Features")).toBe("features");
    });

    it("should collapse multiple spaces to single hyphen", () => {
      expect(slugify("Hello    World")).toBe("hello-world");
    });

    it("should handle mixed case", () => {
      expect(slugify("HeLLo WoRLD")).toBe("hello-world");
    });
  });

  describe("special characters", () => {
    it("should remove & but keep resulting double hyphens", () => {
      expect(slugify("Error Handling & Reference")).toBe("error-handling--reference");
    });

    it("should remove / but keep resulting double hyphens", () => {
      expect(slugify("Problem: High token usage / costs")).toBe("problem-high-token-usage--costs");
    });

    it("should remove colons", () => {
      expect(slugify("Option 1: Factory Function")).toBe("option-1-factory-function");
    });

    it("should remove parentheses", () => {
      expect(slugify("createSAPAIProvider(options?)")).toBe("createsapaiprovideroptions");
    });

    it("should remove question marks and exclamation marks", () => {
      expect(slugify("What is this?")).toBe("what-is-this");
      expect(slugify("Hello World!")).toBe("hello-world");
    });

    it("should handle backticks", () => {
      expect(slugify("`code` Example")).toBe("code-example");
    });
  });

  describe("numbers", () => {
    it("should preserve numbers", () => {
      expect(slugify("Version 2.0")).toBe("version-20");
    });

    it("should handle numbered lists", () => {
      expect(slugify("1. First Step")).toBe("1-first-step");
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      expect(slugify("")).toBe("");
    });

    it("should handle whitespace only", () => {
      expect(slugify("   ")).toBe("");
    });

    it("should trim leading/trailing hyphens", () => {
      expect(slugify("- Hello -")).toBe("hello");
    });

    it("should handle existing hyphens", () => {
      expect(slugify("pre-commit hooks")).toBe("pre-commit-hooks");
    });

    it("should handle underscores (preserved as word chars)", () => {
      expect(slugify("my_function_name")).toBe("my_function_name");
    });
  });

  describe("punctuation and quotes", () => {
    it.each([
      { description: "apostrophes", expected: "its-working", input: "it's working" },
      { description: "possessive apostrophes", expected: "users-guide", input: "user's guide" },
      { description: "double quotes", expected: "the-best-option", input: 'The "best" option' },
      { description: "single quotes", expected: "dont-do-this", input: "Don't do this" },
      { description: "periods (dots)", expected: "version-201", input: "Version 2.0.1" },
      { description: "commas", expected: "hello-world", input: "Hello, World" },
      { description: "semicolons", expected: "part-a-part-b", input: "Part A; Part B" },
      {
        description: "multiple punctuation marks",
        expected: "whats-this-its-a-test",
        input: "What's this? It's a test!",
      },
    ])("should remove $description", ({ expected, input }) => {
      expect(slugify(input)).toBe(expected);
    });
  });

  describe("github-slugger behavior differences (documented)", () => {
    it("should trim leading hyphens (differs from GitHub)", () => {
      expect(slugify("-heading")).toBe("heading");
    });

    it("should trim trailing hyphens (differs from GitHub)", () => {
      expect(slugify("heading-")).toBe("heading");
    });

    it("should trim both leading and trailing hyphens", () => {
      expect(slugify("-heading-")).toBe("heading");
    });

    it("should handle heading with dash prefix/suffix in text", () => {
      expect(slugify("- Hello -")).toBe("hello");
    });

    it("should convert tabs and newlines to hyphens (differs from GitHub)", () => {
      expect(slugify("hello\tworld")).toBe("hello-world");
      expect(slugify("hello\nworld")).toBe("hello-world");
    });
  });

  describe("symbols and special characters", () => {
    it.each([
      { description: "@ symbol", expected: "username-mention", input: "@username mention" },
      { description: "# symbol", expected: "issue-123", input: "Issue #123" },
      { description: "$ symbol", expected: "price-100", input: "Price: $100" },
      { description: "% symbol", expected: "100-complete", input: "100% complete" },
      { description: "^ symbol", expected: "x2-formula", input: "x^2 formula" },
      { description: "+ symbol", expected: "c-programming", input: "C++ Programming" },
      {
        description: "= symbol (keeps double hyphens from spaces)",
        expected: "a--b",
        input: "a = b",
      },
      { description: "< and > symbols", expected: "arraystring", input: "Array<string>" },
      {
        description: "curly braces (keeps double hyphens)",
        expected: "object--key",
        input: "Object { key }",
      },
      { description: "square brackets", expected: "array0", input: "Array[0]" },
      {
        description: "pipe symbol (keeps double hyphens)",
        expected: "option-a--option-b",
        input: "Option A | Option B",
      },
      { description: "backslash", expected: "pathtofile", input: "path\\to\\file" },
    ])("should remove $description", ({ expected, input }) => {
      expect(slugify(input)).toBe(expected);
    });
  });
});

// ============================================================================
// extractHeadings() Tests
// ============================================================================

describe("extractHeadings", () => {
  describe("basic heading extraction", () => {
    it("should extract h1 heading", () => {
      const content = "# Main Title\n\nSome content";
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(1);
      expect(headings[0]).toEqual({
        baseSlug: "main-title",
        level: 1,
        slug: "main-title",
        text: "Main Title",
      });
    });

    it("should extract all heading levels (h1-h6)", () => {
      const content = `
# H1
## H2
### H3
#### H4
##### H5
###### H6
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(6);
      expect(headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it("should extract multiple headings", () => {
      const content = `
# Title
## Section 1
### Subsection
## Section 2
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(4);
      expect(headings.map((h) => h.text)).toEqual([
        "Title",
        "Section 1",
        "Subsection",
        "Section 2",
      ]);
    });
  });

  describe("code block handling", () => {
    it("should exclude headings inside triple backtick code blocks", () => {
      const content = `
# Real Heading

\`\`\`markdown
# Heading in code block
\`\`\`

## Another Real Heading
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(2);
      expect(headings.map((h) => h.text)).toEqual(["Real Heading", "Another Real Heading"]);
    });

    it("should exclude headings inside tilde code blocks", () => {
      const content = `
# Real Heading

~~~
# Heading in code block
~~~

## Another Real Heading
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(2);
    });

    it("should handle code blocks with language specifier", () => {
      const content = `
# Real Heading

\`\`\`typescript
# This is a comment not a heading
const x = 1;
\`\`\`
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(1);
      expect(headings[0]?.text).toBe("Real Heading");
    });
  });

  describe("markdown formatting in headings", () => {
    it("should remove bold formatting (**text**)", () => {
      const content = "## **Bold** Heading";
      const headings = extractHeadings(content);

      expect(headings[0]?.text).toBe("Bold Heading");
    });

    it("should remove italic formatting (*text*)", () => {
      const content = "## *Italic* Heading";
      const headings = extractHeadings(content);

      expect(headings[0]?.text).toBe("Italic Heading");
    });

    it("should remove inline code (`text`)", () => {
      const content = "## The `code` Example";
      const headings = extractHeadings(content);

      expect(headings[0]?.text).toBe("The code Example");
    });

    it("should remove links but keep text ([text](url))", () => {
      const content = "## See [Documentation](https://example.com)";
      const headings = extractHeadings(content);

      expect(headings[0]?.text).toBe("See Documentation");
    });

    it("should handle mixed formatting", () => {
      const content = "## **Bold** and *italic* with `code`";
      const headings = extractHeadings(content);

      expect(headings[0]?.text).toBe("Bold and italic with code");
    });
  });

  describe("duplicate headings", () => {
    it("should add suffix for duplicate headings", () => {
      const content = `
## Features
## Features
## Features
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(3);
      expect(headings[0]?.slug).toBe("features");
      expect(headings[1]?.slug).toBe("features-1");
      expect(headings[2]?.slug).toBe("features-2");
    });

    it("should track baseSlug separately from slug", () => {
      const content = `
## Summary
## Details
## Summary
`;
      const headings = extractHeadings(content);

      expect(headings[0]).toMatchObject({
        baseSlug: "summary",
        slug: "summary",
      });
      expect(headings[2]).toMatchObject({
        baseSlug: "summary",
        slug: "summary-1",
      });
    });

    it("should handle many duplicates correctly", () => {
      const content = `
## Test
## Test
## Test
## Test
## Test
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(5);
      expect(headings.map((h) => h.slug)).toEqual(["test", "test-1", "test-2", "test-3", "test-4"]);
    });

    it("should handle interleaved duplicates", () => {
      const content = `
## Alpha
## Beta
## Alpha
## Gamma
## Beta
## Alpha
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(6);
      expect(headings.map((h) => h.slug)).toEqual([
        "alpha",
        "beta",
        "alpha-1",
        "gamma",
        "beta-1",
        "alpha-2",
      ]);
    });

    it("should handle heading that looks like a duplicate suffix", () => {
      const content = `
## Example
## Example
## Example-1
`;
      const headings = extractHeadings(content);

      // Known limitation: tracks by baseSlug, not final slug
      expect(headings).toHaveLength(3);
      expect(headings[0]?.slug).toBe("example");
      expect(headings[1]?.slug).toBe("example-1");
      expect(headings[2]?.baseSlug).toBe("example-1");
      expect(headings[2]?.slug).toBe("example-1");
    });

    it("should not conflict explicit numbered headings with duplicate suffixes", () => {
      const content = `
## Step 1
## Step 2
## Step 1
`;
      const headings = extractHeadings(content);

      expect(headings).toHaveLength(3);
      expect(headings.map((h) => h.slug)).toEqual(["step-1", "step-2", "step-1-1"]);
    });
  });

  describe("edge cases", () => {
    it("should return empty array for content with no headings", () => {
      const content = "Just some regular text\n\nMore text";
      const headings = extractHeadings(content);

      expect(headings).toEqual([]);
    });

    it("should handle empty content", () => {
      expect(extractHeadings("")).toEqual([]);
    });

    it("should ignore lines that look like headings but aren't", () => {
      const content = `
#Not a heading (no space)
 # Also not (leading space)
`;
      const headings = extractHeadings(content);

      expect(headings).toEqual([]);
    });

    it("should handle headings with special characters", () => {
      const content = "## Error Handling & Reference";
      const headings = extractHeadings(content);

      expect(headings[0]?.slug).toBe("error-handling--reference");
    });
  });
});

// ============================================================================
// extractTocEntries() Tests
// ============================================================================

describe("extractTocEntries", () => {
  describe("basic extraction", () => {
    it("should extract ToC entries from standard format", () => {
      const content = `
# Title

## Table of Contents

- [Features](#features)
- [Installation](#installation)

## Features
`;
      const entries = extractTocEntries(content);

      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({ slug: "features", text: "Features" });
      expect(entries[1]).toEqual({
        slug: "installation",
        text: "Installation",
      });
    });

    it("should extract nested ToC entries", () => {
      const content = `
## Table of Contents

- [Section 1](#section-1)
  - [Subsection 1.1](#subsection-11)
  - [Subsection 1.2](#subsection-12)
- [Section 2](#section-2)

## Section 1
`;
      const entries = extractTocEntries(content);

      expect(entries).toHaveLength(4);
      expect(entries.map((e) => e.slug)).toEqual([
        "section-1",
        "subsection-11",
        "subsection-12",
        "section-2",
      ]);
    });
  });

  describe("edge cases", () => {
    it("should return empty array when no ToC section exists", () => {
      const content = `
# Title

## Features

Some content
`;
      const entries = extractTocEntries(content);

      expect(entries).toEqual([]);
    });

    it("should be case-insensitive for ToC header", () => {
      const content = `
## TABLE OF CONTENTS

- [Features](#features)

## Features
`;
      const entries = extractTocEntries(content);

      expect(entries).toHaveLength(1);
    });

    it("should handle ToC with no links", () => {
      const content = `
## Table of Contents

This ToC has no links, just text.

## Features
`;
      const entries = extractTocEntries(content);

      expect(entries).toEqual([]);
    });

    it("should stop at next h2 heading", () => {
      const content = `
## Table of Contents

- [Features](#features)

## Features

Some regular [link](#not-in-toc) in content.
`;
      const entries = extractTocEntries(content);

      expect(entries).toHaveLength(1);
      expect(entries[0]?.slug).toBe("features");
    });

    it("should handle ToC entries with special characters in text", () => {
      const content = `
## Table of Contents

- [Error Handling & Reference](#error-handling--reference)
- [\`createSAPAIProvider()\`](#createsapaiprovider)

## Features
`;
      const entries = extractTocEntries(content);

      expect(entries).toHaveLength(2);
      expect(entries[0]?.text).toBe("Error Handling & Reference");
      expect(entries[1]?.text).toBe("`createSAPAIProvider()`");
    });
  });
});

// ============================================================================
// validateTocContent() Tests
// ============================================================================

describe("validateTocContent", () => {
  describe("valid ToCs", () => {
    it("should pass for valid ToC with matching headings", () => {
      const content = `
# Title

## Table of Contents

- [Features](#features)
- [Installation](#installation)

## Features

Content here.

## Installation

More content.
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.skipped).toBe(false);
    });

    it("should pass for ToC with nested entries", () => {
      const content = `
## Table of Contents

- [Section 1](#section-1)
  - [Subsection](#subsection)
- [Section 2](#section-2)

## Section 1

### Subsection

## Section 2
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });
  });

  describe("skipped files", () => {
    it("should skip file with no ToC", () => {
      const content = `
# Title

## Features

Content
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("broken links", () => {
    it("should detect ToC link with no matching heading", () => {
      const content = `
## Table of Contents

- [Features](#features)
- [Nonexistent](#nonexistent)

## Features

Content
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("nonexistent");
    });

    it("should suggest similar slugs when available", () => {
      const content = `
## Table of Contents

- [Features](#feature)

## Features

Content
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Did you mean");
      expect(result.errors[0]).toContain("features");
    });
  });

  describe("missing headings in ToC", () => {
    it("should detect h2 heading not in ToC", () => {
      const content = `
## Table of Contents

- [Features](#features)

## Features

Content

## Installation

More content
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Installation"))).toBe(true);
    });

    it("should not complain about missing h3 headings", () => {
      const content = `
## Table of Contents

- [Features](#features)

## Features

### Subsection not in ToC

Content
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });
  });

  describe("duplicate headings", () => {
    it("should handle duplicate headings with correct suffixes", () => {
      const content = `
## Table of Contents

- [Summary](#summary)
- [Details](#details)
- [Summary (again)](#summary-1)

## Summary

First summary.

## Details

Details here.

## Summary

Second summary.
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });

    it("should accept base slug for duplicate headings", () => {
      const content = `
## Table of Contents

- [Summary](#summary)
- [Summary (Part 2)](#summary)

## Summary

First.

## Summary

Second.
`;
      // Both ToC entries point to "summary" which should match both headings
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });
  });

  describe("special characters in headings", () => {
    it("should handle & in headings correctly", () => {
      const content = `
## Table of Contents

- [Error Handling & Reference](#error-handling--reference)

## Error Handling & Reference

Content
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });

    it("should handle / in headings correctly", () => {
      const content = `
## Table of Contents

- [Problem: High usage / costs](#problem-high-usage--costs)

## Problem: High usage / costs

Content
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });
  });

  describe("sibling consistency (h3+)", () => {
    it("should detect partial h3 sibling coverage", () => {
      const content = `
## Table of Contents

- [Section](#section)
  - [Alpha](#alpha)
  - [Beta](#beta)

## Section

### Alpha

### Beta

### Gamma
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("Gamma");
      expect(result.errors[0]).toContain("sibling");
    });

    it("should pass when all h3 siblings are in ToC", () => {
      const content = `
## Table of Contents

- [Section](#section)
  - [Alpha](#alpha)
  - [Beta](#beta)

## Section

### Alpha

### Beta
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });

    it("should pass when no h3 siblings are in ToC (parent gating)", () => {
      const content = `
## Table of Contents

- [Section](#section)

## Section

### Alpha

### Beta

### Gamma
`;
      const result = validateTocContent(content);

      expect(result.valid).toBe(true);
    });
  });
});

// ============================================================================
// buildHeadingTree() Tests
// ============================================================================

describe("buildHeadingTree", () => {
  describe("flat structures", () => {
    it("should return all same-level headings as roots", () => {
      const headings = extractHeadings("## A\n## B\n## C");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(3);
      expect(tree.every((n) => n.children.length === 0)).toBe(true);
    });

    it("should return a single heading as a single root", () => {
      const headings = extractHeadings("## Only");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(1);
      expect(tree[0]?.heading.text).toBe("Only");
      expect(tree[0]?.children).toHaveLength(0);
    });

    it("should handle many same-level siblings", () => {
      const md = Array.from({ length: 10 }, (_, i) => `## H${String(i)}`).join("\n");
      const tree = buildHeadingTree(extractHeadings(md));

      expect(tree).toHaveLength(10);
      expect(tree.every((n) => n.children.length === 0)).toBe(true);
    });
  });

  describe("hierarchical nesting", () => {
    it("should nest h3 under preceding h2", () => {
      const headings = extractHeadings("## Parent\n### Child A\n### Child B");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(1);
      expect(tree[0]?.heading.text).toBe("Parent");
      expect(tree[0]?.children).toHaveLength(2);
      expect(tree[0]?.children[0]?.heading.text).toBe("Child A");
      expect(tree[0]?.children[1]?.heading.text).toBe("Child B");
    });

    it("should handle multiple parents with children", () => {
      const headings = extractHeadings("## P1\n### C1\n## P2\n### C2\n### C3");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(2);
      expect(tree[0]?.children).toHaveLength(1);
      expect(tree[1]?.children).toHaveLength(2);
    });

    it("should handle deep nesting (h2 > h3 > h4)", () => {
      const headings = extractHeadings("## A\n### B\n#### C\n#### D");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(1);
      expect(tree[0]?.children).toHaveLength(1);
      expect(tree[0]?.children[0]?.children).toHaveLength(2);
      expect(tree[0]?.children[0]?.children[0]?.heading.text).toBe("C");
      expect(tree[0]?.children[0]?.children[1]?.heading.text).toBe("D");
    });

    it("should handle very deep nesting (h2 > h3 > h4 > h5 > h6)", () => {
      const headings = extractHeadings("## A\n### B\n#### C\n##### D\n###### E");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(1);
      const h3 = tree[0]?.children[0];
      const h4 = h3?.children[0];
      const h5 = h4?.children[0];
      expect(h5?.heading.text).toBe("D");
      expect(h5?.children[0]?.heading.text).toBe("E");
    });

    it("should handle mixed depths under same parent (h2 > h3 + h4)", () => {
      const headings = extractHeadings("## A\n### B\n#### C\n### D");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(1);
      expect(tree[0]?.children).toHaveLength(2);
      expect(tree[0]?.children[0]?.heading.text).toBe("B");
      expect(tree[0]?.children[0]?.children[0]?.heading.text).toBe("C");
      expect(tree[0]?.children[1]?.heading.text).toBe("D");
      expect(tree[0]?.children[1]?.children).toHaveLength(0);
    });
  });

  describe("level jumps and stack unwinding", () => {
    it("should handle level jumps (h2 directly to h4)", () => {
      const headings = extractHeadings("## A\n#### B\n#### C");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(1);
      expect(tree[0]?.children).toHaveLength(2);
      expect(tree[0]?.children[0]?.heading.text).toBe("B");
    });

    it("should pop back to correct parent after deep nesting", () => {
      const headings = extractHeadings("## A\n### B\n#### C\n## D\n### E");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(2);
      expect(tree[0]?.heading.text).toBe("A");
      expect(tree[0]?.children[0]?.heading.text).toBe("B");
      expect(tree[0]?.children[0]?.children[0]?.heading.text).toBe("C");
      expect(tree[1]?.heading.text).toBe("D");
      expect(tree[1]?.children[0]?.heading.text).toBe("E");
    });

    it("should handle h6 jumping back to h2", () => {
      const headings = extractHeadings("## A\n###### Deep\n## B");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(2);
      expect(tree[0]?.children[0]?.heading.text).toBe("Deep");
      expect(tree[1]?.heading.text).toBe("B");
    });
  });

  describe("edge cases", () => {
    it("should return empty array for empty input", () => {
      expect(buildHeadingTree([])).toEqual([]);
    });

    it("should handle all h1 headings as roots", () => {
      const headings = extractHeadings("# A\n# B\n# C");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(3);
    });

    it("should handle alternating levels (h2, h4, h2, h4)", () => {
      const headings = extractHeadings("## A\n#### X\n## B\n#### Y");
      const tree = buildHeadingTree(headings);

      expect(tree).toHaveLength(2);
      expect(tree[0]?.children[0]?.heading.text).toBe("X");
      expect(tree[1]?.children[0]?.heading.text).toBe("Y");
    });
  });
});

// ============================================================================
// findInconsistentSiblings() Tests
// ============================================================================

describe("findInconsistentSiblings", () => {
  describe("no errors cases", () => {
    it("should return no errors when all siblings are in ToC", () => {
      const headings = extractHeadings("## Parent\n### A\n### B");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a", "b"]);
      const tocParentSlugs = new Set(["parent"]);

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });

    it("should return no errors when no siblings are in ToC", () => {
      const headings = extractHeadings("## Parent\n### A\n### B\n### C");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set<string>();
      const tocParentSlugs = new Set<string>();

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });

    it("should return no errors for a single child (no siblings to compare)", () => {
      const headings = extractHeadings("## Parent\n### Only");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["only"]);
      const tocParentSlugs = new Set(["parent"]);

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });

    it("should return no errors when tree is empty", () => {
      expect(findInconsistentSiblings([], new Set(), new Set())).toEqual([]);
    });
  });

  describe("detection cases", () => {
    it("should detect when some but not all siblings are in ToC", () => {
      const headings = extractHeadings("## Parent\n### A\n### B\n### C");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a", "b"]);
      const tocParentSlugs = new Set(["parent"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("C");
      expect(errors[0]).toContain("Parent");
    });

    it("should report each missing sibling individually", () => {
      const headings = extractHeadings("## Parent\n### A\n### B\n### C\n### D");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a"]);
      const tocParentSlugs = new Set(["parent"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(3);
      expect(errors.some((e) => e.includes("B"))).toBe(true);
      expect(errors.some((e) => e.includes("C"))).toBe(true);
      expect(errors.some((e) => e.includes("D"))).toBe(true);
    });

    it("should include heading level in error message", () => {
      const headings = extractHeadings("## Parent\n### Listed\n### Missing");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["listed"]);
      const tocParentSlugs = new Set(["parent"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("h3");
    });

    it("should detect inconsistency at h4 level", () => {
      const headings = extractHeadings("## A\n### B\n#### C1\n#### C2");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["b", "c1"]);
      const tocParentSlugs = new Set(["a", "b"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("C2");
      expect(errors[0]).toContain("h4");
    });

    it("should detect inconsistency at h5 level", () => {
      const headings = extractHeadings("## A\n### B\n#### C\n##### D1\n##### D2");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["b", "c", "d1"]);
      const tocParentSlugs = new Set(["a", "b", "c"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("D2");
      expect(errors[0]).toContain("h5");
    });
  });

  describe("parent gating", () => {
    it("should skip siblings when parent is not a ToC parent (leaf entry)", () => {
      const headings = extractHeadings("## Parent\n### A\n### B\n### C");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a", "b"]);
      const tocParentSlugs = new Set<string>(); // parent has no indented children in ToC

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });

    it("should check groups under different parents independently", () => {
      const headings = extractHeadings("## P1\n### A\n### B\n## P2\n### C\n### D");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a", "b"]);
      const tocParentSlugs = new Set(["p1"]);

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });

    it("should detect errors only under parents with ToC children", () => {
      const headings = extractHeadings("## P1\n### A\n### B\n## P2\n### C\n### D");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a", "c"]);
      const tocParentSlugs = new Set(["p1"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("B");
      expect(errors[0]).toContain("P1");
    });

    it("should report 'document root' for root-level siblings", () => {
      const headings = extractHeadings("### A\n### B\n### C");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a"]);
      const tocParentSlugs = new Set<string>();

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain("document root");
    });
  });

  describe("h2 exclusion", () => {
    it("should skip h2 headings (handled by mandatory check)", () => {
      const headings = extractHeadings("## A\n## B\n## C");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a"]);
      const tocParentSlugs = new Set<string>();

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });

    it("should skip h2 siblings even when under a ToC parent at root level", () => {
      const headings = extractHeadings("## A\n## B");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["a"]);
      const tocParentSlugs = new Set(["a"]);

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });
  });

  describe("duplicate headings", () => {
    it("should handle duplicate headings via baseSlug matching", () => {
      const headings = extractHeadings("## Parent\n### Item\n### Item");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["item"]);
      const tocParentSlugs = new Set(["parent"]);

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });

    it("should detect missing duplicates when some are listed", () => {
      const headings = extractHeadings("## Parent\n### Item\n### Item\n### Other");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["item"]); // matches both Items via baseSlug, but not Other
      const tocParentSlugs = new Set(["parent"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("Other");
    });
  });

  describe("recursive depth checking", () => {
    it("should detect errors at multiple depths simultaneously", () => {
      const headings = extractHeadings("## A\n### B\n#### C1\n#### C2\n### D\n#### E1\n#### E2");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["b", "c1", "d", "e1"]);
      const tocParentSlugs = new Set(["a", "b", "d"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(2);
      expect(errors.some((e) => e.includes("C2"))).toBe(true);
      expect(errors.some((e) => e.includes("E2"))).toBe(true);
    });

    it("should handle deeply nested tree with errors only at leaf level", () => {
      const headings = extractHeadings("## A\n### B\n#### C\n##### D1\n##### D2");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["b", "c", "d1"]);
      const tocParentSlugs = new Set(["a", "b", "c"]);

      const errors = findInconsistentSiblings(tree, tocSlugs, tocParentSlugs);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("D2");
    });
  });

  describe("special characters in headings", () => {
    it("should handle headings with special characters in slugs", () => {
      const headings = extractHeadings("## Parent\n### Error Handling & Ref\n### Other Section");
      const tree = buildHeadingTree(headings);
      const tocSlugs = new Set(["error-handling--ref", "other-section"]);
      const tocParentSlugs = new Set(["parent"]);

      expect(findInconsistentSiblings(tree, tocSlugs, tocParentSlugs)).toEqual([]);
    });
  });
});

// ============================================================================
// extractTocParentSlugs() Tests
// ============================================================================

describe("extractTocParentSlugs", () => {
  describe("basic extraction", () => {
    it("should return empty set when no ToC exists", () => {
      expect(extractTocParentSlugs("## Features\n\nSome text")).toEqual(new Set());
    });

    it("should return empty set when ToC has only flat entries", () => {
      const content = `
## Table of Contents

- [A](#a)
- [B](#b)
- [C](#c)

## A
## B
## C`;
      expect(extractTocParentSlugs(content)).toEqual(new Set());
    });

    it("should identify a single parent with indented children", () => {
      const content = `
## Table of Contents

- [Section](#section)
  - [Alpha](#alpha)
  - [Beta](#beta)

## Section
### Alpha
### Beta`;
      expect(extractTocParentSlugs(content)).toEqual(new Set(["section"]));
    });
  });

  describe("nesting levels", () => {
    it("should identify multiple parents at different indent levels", () => {
      const content = `
## Table of Contents

- [A](#a)
  - [B](#b)
    - [C](#c)

## A
### B
#### C`;
      const parents = extractTocParentSlugs(content);
      expect(parents.has("a")).toBe(true);
      expect(parents.has("b")).toBe(true);
      expect(parents.has("c")).toBe(false);
    });

    it("should handle three levels of nesting", () => {
      const content = `
## Table of Contents

- [Root](#root)
  - [Mid](#mid)
    - [Leaf](#leaf)

## Root
### Mid
#### Leaf`;
      const parents = extractTocParentSlugs(content);
      expect(parents).toEqual(new Set(["mid", "root"]));
    });

    it("should handle multiple parents at the same indent level", () => {
      const content = `
## Table of Contents

- [P1](#p1)
  - [C1](#c1)
- [P2](#p2)
  - [C2](#c2)

## P1
### C1
## P2
### C2`;
      const parents = extractTocParentSlugs(content);
      expect(parents).toEqual(new Set(["p1", "p2"]));
    });
  });

  describe("leaf vs parent distinction", () => {
    it("should not mark leaf entries as parents", () => {
      const content = `
## Table of Contents

- [Parent](#parent)
  - [Child](#child)
- [Leaf](#leaf)

## Parent
### Child
## Leaf`;
      const parents = extractTocParentSlugs(content);
      expect(parents.has("parent")).toBe(true);
      expect(parents.has("child")).toBe(false);
      expect(parents.has("leaf")).toBe(false);
    });

    it("should not mark the last entry as parent (no next entry)", () => {
      const content = `
## Table of Contents

- [A](#a)
- [B](#b)

## A
## B`;
      const parents = extractTocParentSlugs(content);
      expect(parents.has("a")).toBe(false);
      expect(parents.has("b")).toBe(false);
    });

    it("should handle entry followed by same-indent entry (not a parent)", () => {
      const content = `
## Table of Contents

- [A](#a)
- [B](#b)
  - [C](#c)

## A
## B
### C`;
      const parents = extractTocParentSlugs(content);
      expect(parents.has("a")).toBe(false);
      expect(parents.has("b")).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should return empty set for empty content", () => {
      expect(extractTocParentSlugs("")).toEqual(new Set());
    });

    it("should return empty set for ToC with a single entry", () => {
      const content = `
## Table of Contents

- [Only](#only)

## Only`;
      expect(extractTocParentSlugs(content)).toEqual(new Set());
    });

    it("should handle tab indentation in ToC entries", () => {
      const content = `
## Table of Contents

- [Parent](#parent)
\t- [Child](#child)

## Parent
### Child`;
      // Tab is 1 char indent vs 2 spaces; still greater indent
      const parents = extractTocParentSlugs(content);
      expect(parents.has("parent")).toBe(true);
    });

    it("should handle four-space indentation", () => {
      const content = `
## Table of Contents

- [Parent](#parent)
    - [Child](#child)

## Parent
### Child`;
      const parents = extractTocParentSlugs(content);
      expect(parents.has("parent")).toBe(true);
    });
  });
});
