# Review Agent

Review and validate the implementation on branch `{{BRANCH}}`.

## Setup

```bash
git checkout {{BRANCH}}
```

## Changes to Review

!`git diff --stat main...{{BRANCH}}`

## Commits on This Branch

!`git log main..{{BRANCH}} --oneline`

## Validation

Run the full CI validation suite. Every command must exit 0:

```bash
npm run type-check
npm run test
npm run test:node
npm run test:edge
npm run prettier-check
npm run lint
npm run build
npm run check-build
npm run build:v2
npm run check-build:v2
```

## On Failure

If any command fails:

1. Read the error output.
2. Fix the issue in the source code.
3. Commit the fix: `fix: <describe what was wrong>`.
4. Re-run the full suite from the top.
5. Repeat until all commands pass.

## Quality Checks

After validation passes, verify compliance with the coding standards in `CONTRIBUTING.md`. Fix violations and commit.

## Rules

- Zero errors, zero warnings from type-check and lint.
- All tests pass in both Node.js and Edge environments.
- Both V3 and V2 builds succeed.
- Do not skip or disable tests.

## Completion

When the full suite passes cleanly, push the fixes and output:

```bash
git push
```

```text
<promise>COMPLETE</promise>
```
