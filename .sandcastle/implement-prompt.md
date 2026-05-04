# Implement Agent

Implement issue **#{{TASK_ID}}** ("{{ISSUE_TITLE}}") on branch `{{BRANCH}}`.

## Issue Details

!`gh issue view {{TASK_ID}} --json body,title,labels,comments`

## Recent Commits

!`git log -n 10 --format="%h %s" --date=short`

## Exploration

Explore the repo to understand the architecture before coding. Pay attention to:

- Files related to the issue
- Test files touching relevant modules
- Existing patterns in similar code

Read `AGENTS.md` and `CONTRIBUTING.md` for project conventions.

## Implementation

1. Implement the fix/feature. Follow existing patterns:
   - Strict TypeScript, JSDoc on public APIs
   - Co-located tests in `*.test.ts` files
   - Zod for runtime validation

2. Before every commit, run the full validation suite:

   ```bash
   npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2
   ```

3. Commit with conventional commits:
   - `fix: <description>` — bug fix
   - `feat: <description>` — new feature
   - `refactor: <description>` — restructuring
   - `chore: <description>` — tooling/config

4. Push the branch:

   ```bash
   git push -u origin {{BRANCH}}
   ```

## Rules

- One logical change per commit.
- Tests must pass before pushing. Zero type errors, zero test failures.
- Do not modify unrelated files.
- Do not bump version numbers.

## Completion

When validation passes and the branch is pushed, output:

```text
<promise>COMPLETE</promise>
```
