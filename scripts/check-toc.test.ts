import { describe, expect, it } from "vitest";

import { validateTocContent } from "./check-toc";

describe("Markdown table of contents validation", () => {
  it("validates rendered Unicode and inline code anchors without trimming GitHub hyphens", () => {
    const content = [
      "## Table of Contents",
      "- [API](#-café-my_var)",
      "- [Hyphens](#-edge-)",
      "",
      "## \u{1f680} Café `my_var`",
      "## -edge-",
    ].join("\n");
    expect(validateTocContent(content)).toEqual({ errors: [], skipped: false, valid: true });
  });

  it("decodes fragment escapes and uses rendered formatting rather than Markdown syntax", () => {
    const content = [
      "## Table of Contents",
      "- [Café](#caf%C3%A9--a_b_c--reference)",
      "",
      "## **Café** & `a_b_c` / [Reference](https://example.com)",
    ].join("\n");
    expect(validateTocContent(content).valid).toBe(true);
  });

  it("allocates duplicate anchors without colliding with explicit numbered headings", () => {
    const content = [
      "## Table of Contents",
      "- [First](#a)",
      "- [Second](#a-1)",
      "- [Third](#a-1-1)",
      "",
      "## A",
      "## A",
      "## A-1",
    ].join("\n");
    expect(validateTocContent(content).valid).toBe(true);
  });

  it("does not let a link to the first duplicate cover subsequent headings", () => {
    expect(
      validateTocContent("## Table of Contents\n- [A](#a)\n- [A again](#a)\n\n## A\n## A").valid,
    ).toBe(false);
  });

  it("requires duplicate siblings individually when their parent is expanded", () => {
    expect(
      validateTocContent(
        "## Table of Contents\n- [Parent](#parent)\n  - [Item](#item)\n\n## Parent\n### Item\n### Item",
      ).valid,
    ).toBe(false);
  });

  it("ignores mismatched and shorter fence closers while recognizing indented headings", () => {
    const content = [
      "## Table of Contents",
      "- [Real](#real)",
      "- [Indented](#indented)",
      "",
      "````markdown",
      "~~~",
      "## Not a heading",
      "```",
      "## Still code",
      "````",
      "## Real",
      "   ## Indented ###",
      "",
      "    ## Indented code",
    ].join("\n");
    expect(validateTocContent(content).valid).toBe(true);
  });

  it("recognizes setext headings but excludes headings and links inside code blocks", () => {
    const content = [
      "Table of Contents",
      "-----------------",
      "- [Real](#real)",
      "",
      "```markdown",
      "- [Fake](#fake)",
      "## Fake",
      "```",
      "",
      "Real",
      "----",
    ].join("\n");
    expect(validateTocContent(content)).toEqual({ errors: [], skipped: false, valid: true });
  });

  it.each([
    "```markdown\n## Table of Contents\n- [Missing](#missing)\n```\n## Real",
    "### Table of Contents\n- [Missing](#missing)\n## Real",
    "# Document\n## Real",
  ])("skips documents without a rendered level-two table of contents", (content) => {
    expect(validateTocContent(content)).toEqual({ errors: [], skipped: true, valid: true });
  });

  it("rejects an explicitly empty table of contents when document headings are missing", () => {
    expect(validateTocContent("## Table of Contents\n\n## Unlisted").valid).toBe(false);
  });

  it.each(["# Boundary", "## Boundary"])(
    "stops collecting table-of-contents links at the next %s",
    (boundary) => {
      const content = [
        "## Table of Contents",
        "- [Boundary](#boundary)",
        "",
        boundary,
        "[Not a table-of-contents entry](#missing)",
      ].join("\n");
      expect(validateTocContent(content).valid).toBe(true);
    },
  );

  it("does not count blank lines as nested list indentation", () => {
    const content = [
      "## Table of Contents",
      "- [A](#a)",
      "",
      "- [B](#b)",
      "- [Selected detail](#selected-detail)",
      "",
      "## A",
      "### Selected detail",
      "### Other detail",
      "## B",
    ].join("\n");
    expect(validateTocContent(content).valid).toBe(true);
  });

  it("checks actual nested lists independently for each parent, including ordered lists", () => {
    const content = [
      "## Table of Contents",
      "1. [A](#a)",
      "   1. [First](#first)",
      "2. [B](#b)",
      "",
      "## A",
      "### First",
      "### Omitted",
      "## B",
      "### Optional",
    ].join("\n");
    expect(validateTocContent(content).valid).toBe(false);
    expect(validateTocContent(content.replace("### Omitted\n", "")).valid).toBe(true);
  });

  it("finds partial coverage at deeper levels without requiring unexpanded subtrees", () => {
    const content = [
      "## Table of Contents",
      "- [A](#a)",
      "  - [B](#b)",
      "    - [C](#c)",
      "  - [D](#d)",
      "",
      "## A",
      "### B",
      "#### C",
      "#### Missing",
      "### D",
      "#### Optional",
    ].join("\n");
    expect(validateTocContent(content).valid).toBe(false);
    expect(validateTocContent(content.replace("#### Missing\n", "")).valid).toBe(true);
  });

  it("requires every level-two heading but permits unexpanded details", () => {
    const content = "## Table of Contents\n- [A](#a)\n\n## A\n### Detail\n## B";
    expect(validateTocContent(content).valid).toBe(false);
    expect(validateTocContent(content.replace("\n## B", "")).valid).toBe(true);
  });

  it("rejects unknown and malformed anchors rather than throwing", () => {
    const content = "## Table of Contents\n- [A](#a)\n- [Broken](#%not-an-escape)\n\n## A";
    expect(validateTocContent(content).valid).toBe(false);
  });
});
