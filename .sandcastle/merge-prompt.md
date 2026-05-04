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
   - Resolve favoring the incoming branch changes unless they break existing tests.
   - Stage resolved files and complete the merge.

5. After all merges, run full validation:

   ```bash
   npm run type-check && npm run test && npm run test:node && npm run test:edge && npm run prettier-check && npm run lint && npm run build && npm run check-build && npm run build:v2 && npm run check-build:v2
   ```

6. If validation fails, fix the issue and amend the merge commit.

7. Create a pull request. Format the body so each issue gets a proper close keyword:

   ```bash
   gh pr create --title "chore: merge agent-completed branches" --body "<body>" --head agent/merge-batch --base main
   ```

   The body must contain one `Closes #N` per line for each issue number (not the markdown list format). Example:

   ```text
   Merged branches:
   - agent/issue-42-fix-auth
   - agent/issue-55-add-cache

   Closes #42
   Closes #55
   ```

## Rules

- Every merge uses `--no-ff` to preserve branch history.
- Validation must pass after all merges complete.
- Do not push directly to main — create a PR for human review instead.
- Do not force-push.
- Do not delete remote branches (leave for cleanup elsewhere).
- Do not close issues manually — the PR merge handles it via "Closes #N" in the body.

## Completion

When all branches are merged, validation passes, and the PR is created, output:

```text
<promise>COMPLETE</promise>
```
