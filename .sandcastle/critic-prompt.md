# Critic Agent

Analyze the implementation on branch `{{BRANCH}}` and produce structured findings.

## Task

Run `git diff main...{{BRANCH}}` to see all changes. Examine the diff carefully. For each issue found, produce a structured finding.

Read `CONTRIBUTING.md` for the project's coding standards.

## Output Format

Output your findings as JSON wrapped in nonce-tagged delimiters. Use EXACTLY this tag format:

```text
<findings-{{NONCE}}>[...]</findings-{{NONCE}}>
```

Each finding must have this structure:

```json
{
  "file": "path/to/file.ts",
  "line": 42,
  "title": "short description of the issue",
  "severity": "CRITICAL|HIGH|MEDIUM|LOW",
  "category": "security|logic|performance|architecture|style",
  "confidence": "HIGH|MEDIUM|LOW",
  "description": "detailed explanation of why this is a problem",
  "suggestion": "how to fix it"
}
```

If no issues are found, output:

```text
<findings-{{NONCE}}>[]</findings-{{NONCE}}>
```

## Rules

- Do NOT modify any files. Do NOT commit. Do NOT push.
- Only report issues in the CHANGED code (not pre-existing issues).
- Use HIGH confidence only when you've verified the issue by reading the relevant code.
- Use MEDIUM confidence for pattern-based detection.
- Use LOW confidence for style preferences or uncertain issues.
- Focus on: logic errors, missing edge cases, security issues, type safety violations, test gaps.
- Do NOT report formatting issues (prettier handles those).

## Completion

After outputting the findings, output:

```text
<promise>COMPLETE</promise>
```
