# Merge Agent

Merge completed branches and create a pull request.

## Inputs

- Branches: {{BRANCHES}}
- Issues: {{ISSUES}}

## Current State

!`git status --short`

!`git branch -a | grep agent/ || true`

## Steps

1. Create a merge branch from main:

   ```bash
   git branch -D agent/merge-batch 2>/dev/null || true
   git checkout -b agent/merge-batch origin/main
   ```

2. Ensure working tree is clean.

3. Merge each branch with a merge commit:

   ```bash
   git merge --no-ff <branch>
   ```

   Process branches in the order given.

4. If a merge conflict occurs:
   - Read the conflicting files.
   - Resolve favoring the incoming branch changes. Validation in step 6 will catch regressions.
   - Stage resolved files and complete the merge.

5. After all merges, verify that `git diff main...agent/merge-batch` shows changes. If there are no file changes compared to main, do NOT create a PR — output `<promise>COMPLETE</promise>` and stop.

6. Run full validation:

   ```bash
   npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2
   ```

7. If validation fails, fix the issue and amend the merge commit.

8. Push the branch and create a pull request. Read `.github/PULL_REQUEST_TEMPLATE.md` and fill in all sections. Use conventional commit format for the title (`feat:`, `fix:`, `chore:`, `refactor:`). Include `Fixes #N` for each resolved issue in the Related Issues section.

## Rules

- Every merge uses `--no-ff` to preserve branch history.
- Validation must pass after all merges complete.
- Do not push directly to main — create a PR for human review instead.
- Do not force-push.
- Do not delete remote branches (leave for cleanup elsewhere).
- Do not close issues manually — the PR merge handles it via "Fixes #N" in the body.
- Do not create a PR if there are zero file changes compared to main.

## Completion

When all branches are merged, validation passes, and the PR is created, output:

```text
<promise>COMPLETE</promise>
```
