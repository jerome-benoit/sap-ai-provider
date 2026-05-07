# Actor Agent: Implementer

Implement issue **#{{TASK_ID}}** ("{{ISSUE_TITLE}}") on branch `{{BRANCH}}`.

## Issue Details

{{ISSUE_BODY}}

{{PLAN_CONTEXT}}

## Review Findings

{{FINDINGS}}

## Exploration

Explore the repo to understand the architecture before coding. Pay attention to:

- Files related to the issue
- Test files touching relevant modules
- Existing patterns in similar code

Read `AGENTS.md`, `CONTRIBUTING.md`, `.serena/memories/style_and_conventions` and `.serena/memories/task_completion_checklist`.

## Implementation

1. If review findings are provided above, cross-validate each one against the code. Fix findings you agree with. Ignore findings that are incorrect or not applicable.

2. If no findings are provided, implement the issue from scratch following existing patterns:
   - Strict TypeScript, JSDoc on public APIs
   - Co-located tests in `*.test.ts` files
   - Zod for runtime validation

3. Before every commit, run the full validation suite:

   ```bash
   npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2
   ```

4. Commit with conventional commits:
   - `fix: <description>` — bug fix
   - `feat: <description>` — new feature
   - `refactor: <description>` — restructuring
   - `chore: <description>` — tooling/config

5. Push the branch:

   ```bash
   git push -u origin {{BRANCH}}
   ```

## Rules

- One logical change per commit.
- Tests must pass before pushing. Zero type errors, zero test failures.
- Do not modify unrelated files.
- Do not bump version numbers.
- Push BEFORE signaling completion.

## Completion

When validation passes and the branch is pushed, output:

```text
<promise>COMPLETE</promise>
```
