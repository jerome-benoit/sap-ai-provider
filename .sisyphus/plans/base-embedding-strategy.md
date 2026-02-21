# BaseEmbeddingModelStrategy - Abstract Base Class Implementation

## TL;DR

> **Quick Summary**: Create an abstract base class `BaseEmbeddingModelStrategy` using the Template Method pattern to consolidate ~50 lines of duplicate code between `OrchestrationEmbeddingModelStrategy` and `FoundationModelsEmbeddingModelStrategy`, achieving architectural symmetry with the existing `BaseLanguageModelStrategy`.
>
> **Deliverables**:
>
> - `src/base-embedding-model-strategy.ts` - New abstract base class (~80-100 lines)
> - Refactored `OrchestrationEmbeddingModelStrategy` (~70 lines, down from 119)
> - Refactored `FoundationModelsEmbeddingModelStrategy` (~60 lines, down from 104)
> - Updated exports in `src/index.ts`
> - Updated `ARCHITECTURE.md` documentation
>
> **Estimated Effort**: Medium (4-6 hours)
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Tasks 2,3 (parallel) → Task 4 → Task 5 → Task 6

---

## Context

### Original Request

Audit the codebase for orthogonality and class hierarchy elegance, then plan the creation of an abstract base class for embedding model strategies following state-of-the-art design patterns.

### Interview Summary

**Key Discussions**:

- Module orthogonality audit scored 9.3/10 - clean architecture confirmed
- Class hierarchy audit scored 4.7/5 - identified asymmetry between Language Models (has base class) and Embedding Models (no base class)
- ~30-50 lines of code duplication identified across both embedding strategies
- Template Method pattern selected to match existing `BaseLanguageModelStrategy`

**Research Findings**:

- Both strategies share: imports, `doEmbed` signature, `prepareEmbeddingCall()` invocation, `buildEmbeddingResult()` call, error handling pattern
- V8 optimization guidance: Keep inheritance to 2-3 levels max (we'll have 2)
- Follow existing `BaseLanguageModelStrategy` pattern for codebase consistency
- Vercel AI SDK uses composition, but our codebase uses inheritance - stay consistent

### Metis Review

**Identified Gaps** (addressed):

- Token extraction differs (`getTokenUsage()` vs `._data.usage`) → Added `extractTokenCount()` as 6th abstract method
- Orchestration sorts embeddings by `.index`; Foundation Models doesn't → Added optional `sortEmbeddings()` hook
- Constructor signature variance → Handled via generic `TClient` type parameter
- Masking support asymmetry → Stays in Orchestration concrete class (settings passthrough)

---

## Work Objectives

### Core Objective

Consolidate duplicate code into a shared abstract base class while preserving 100% behavioral compatibility with existing implementations.

### Concrete Deliverables

- `src/base-embedding-model-strategy.ts` - Abstract base class with Template Method pattern
- Refactored `src/orchestration-embedding-model-strategy.ts` - Extends base class
- Refactored `src/foundation-models-embedding-model-strategy.ts` - Extends base class
- Updated `src/index.ts` - Export base class (internal only)
- Updated `ARCHITECTURE.md` - Document new class hierarchy

### Definition of Done

- [ ] `npm run build` passes with no errors
- [ ] `npm run check-build` passes with no errors
- [ ] `npm run test` passes (all existing tests green)
- [ ] `npm run lint` passes with no new warnings
- [ ] Total LOC for all 3 files ≤ 230 lines (current: 223 lines)
- [ ] No `any` types introduced
- [ ] JSDoc documentation on all public/protected methods

### Must Have

- Generic type parameters `<TClient, TResponse>` for type-safe implementations
- 6 abstract methods: `createClient`, `executeCall`, `extractEmbeddings`, `extractTokenCount`, `getUrl`, `getModelId`
- Optional hook `sortEmbeddings()` with default no-op implementation
- Template method `doEmbed()` containing shared algorithm
- Error handling with provider-specific URLs preserved
- Full backward compatibility - no observable behavior changes

### Must NOT Have (Guardrails)

- ❌ NO changes to `EmbeddingModelAPIStrategy` interface in `sap-ai-strategy.ts`
- ❌ NO changes to `strategy-utils.ts` helper functions
- ❌ NO changes to `sap-ai-embedding-model.ts` (consumer)
- ❌ NO new dependencies beyond what's already imported
- ❌ NO reduction in test coverage
- ❌ NO `any` types or `@ts-ignore` comments
- ❌ NO changes to error URL patterns (`sap-ai:orchestration/embeddings`, `sap-ai:foundation-models/embeddings`)
- ❌ NO generic embedding type abstraction (Orchestration's `type` param stays in concrete class)
- ❌ NO modification of token extraction logic beyond method extraction

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.
> Acceptance criteria requiring "user manually tests/confirms" are FORBIDDEN.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: Tests-after (existing tests remain; add base class unit tests if needed)
- **Framework**: vitest (npm run test)

### QA Policy

Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Build verification**: Use Bash - `npm run build`, `npm run check-build`
- **Test execution**: Use Bash - `npm run test`, check exit code and output
- **Lint check**: Use Bash - `npm run lint`
- **Type check**: Use Bash - `npm run type-check`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - must complete first):
└── Task 1: Create BaseEmbeddingModelStrategy [deep]

Wave 2 (Parallel refactoring - after Wave 1):
├── Task 2: Refactor OrchestrationEmbeddingModelStrategy [quick]
└── Task 3: Refactor FoundationModelsEmbeddingModelStrategy [quick]

Wave 3 (Integration - after Wave 2):
└── Task 4: Update exports and verify integration [quick]

Wave 4 (Documentation - after Wave 3):
└── Task 5: Update ARCHITECTURE.md [writing]

Wave FINAL (Verification - after ALL tasks):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Full test suite QA [unspecified-high]
└── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Tasks 2,3 → Task 4 → Task 5 → F1-F4
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Wave 2)
```

### Dependency Matrix

| Task  | Depends On | Blocks |
| ----- | ---------- | ------ |
| 1     | -          | 2, 3   |
| 2     | 1          | 4      |
| 3     | 1          | 4      |
| 4     | 2, 3       | 5      |
| 5     | 4          | F1-F4  |
| F1-F4 | 5          | -      |

### Agent Dispatch Summary

- **Wave 1**: 1 task — T1 → `deep` (complex abstract class design)
- **Wave 2**: 2 tasks — T2, T3 → `quick` (straightforward refactoring)
- **Wave 3**: 1 task — T4 → `quick` (simple export updates)
- **Wave 4**: 1 task — T5 → `writing` (documentation)
- **FINAL**: 4 tasks — F1 → `oracle`, F2-F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Create BaseEmbeddingModelStrategy Abstract Base Class

  **What to do**:
  - Create new file `src/base-embedding-model-strategy.ts`
  - Define generic abstract class: `BaseEmbeddingModelStrategy<TClient, TResponse>`
  - Implement template method `doEmbed()` with shared algorithm:
    1. Call `prepareEmbeddingCall()` from strategy-utils
    2. Call abstract `createClient()` hook
    3. Call abstract `executeCall()` hook
    4. Call abstract `extractEmbeddings()` hook
    5. Call `sortEmbeddings()` hook (default no-op)
    6. Call abstract `extractTokenCount()` hook
    7. Call `buildEmbeddingResult()` from strategy-utils
    8. Wrap in try-catch using `getUrl()` for error context
  - Define 6 abstract methods:
    - `createClient(config, settings, embeddingOptions): TClient`
    - `executeCall(client, values, embeddingType, abortSignal): Promise<TResponse>`
    - `extractEmbeddings(response: TResponse): EmbeddingModelV3Embedding[]`
    - `extractTokenCount(response: TResponse): number`
    - `getUrl(): string`
    - `getModelId(): string`
  - Define 1 optional hook with default implementation:
    - `sortEmbeddings(embeddings): embeddings` (returns input unchanged)
  - Add JSDoc documentation matching `BaseLanguageModelStrategy` style
  - Mark class as `@internal` (not for public API)

  **Must NOT do**:
  - Do NOT add any new dependencies
  - Do NOT add more than 6 abstract methods + 1 optional hook
  - Do NOT change any existing utility functions

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires careful abstract class design with generic type parameters and template method pattern
  - **Skills**: `[]`
    - No special skills needed - pure TypeScript abstraction work
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed until commit phase

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (foundation)
  - **Blocks**: Tasks 2, 3
  - **Blocked By**: None (can start immediately)

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `src/base-language-model-strategy.ts:1-351` - FULL FILE: Template Method pattern reference implementation. Copy the structure: constructor pattern, abstract method signatures, JSDoc style, error handling with `getUrl()`, generic type parameters
  - `src/base-language-model-strategy.ts:94-123` - `doGenerate()` template method structure with try-catch wrapping abstract hooks
  - `src/base-language-model-strategy.ts:67-71` - Abstract class declaration with generic type parameters

  **API/Type References** (contracts to implement against):
  - `src/sap-ai-strategy.ts:19-26` - `EmbeddingModelAPIStrategy` interface - the contract this base class implements
  - `src/sap-ai-strategy.ts:29-34` - `EmbeddingModelStrategyConfig` type - parameter shape for doEmbed
  - `src/sap-ai-settings.ts:SAPAIEmbeddingSettings` - Settings type for embedding operations

  **Implementation References** (code to consolidate):
  - `src/orchestration-embedding-model-strategy.ts:1-119` - FULL FILE: First concrete implementation to analyze for shared code extraction
  - `src/foundation-models-embedding-model-strategy.ts:1-104` - FULL FILE: Second concrete implementation to analyze
  - `src/orchestration-embedding-model-strategy.ts:42-93` - `doEmbed()` method showing algorithm to templatize
  - `src/foundation-models-embedding-model-strategy.ts:41-79` - `doEmbed()` method showing algorithm to templatize

  **Utility References** (shared helpers to call from template):
  - `src/strategy-utils.ts:prepareEmbeddingCall` - Import and call in template method step 1
  - `src/strategy-utils.ts:buildEmbeddingResult` - Import and call in template method step 7
  - `src/strategy-utils.ts:normalizeEmbedding` - May be needed for embedding extraction

  **WHY Each Reference Matters**:
  - `base-language-model-strategy.ts` is the gold standard for how to implement Template Method in this codebase - copy its structure exactly
  - Both embedding strategies show the shared algorithm that will become the template method
  - `strategy-utils.ts` has the shared helpers that are already extracted - use them, don't re-implement
  - The strategy interface defines the contract - base class must implement it correctly

  **Acceptance Criteria**:
  - [ ] File created: `src/base-embedding-model-strategy.ts`
  - [ ] Class is abstract with generic parameters `<TClient, TResponse>`
  - [ ] Implements `EmbeddingModelAPIStrategy` interface
  - [ ] Has exactly 6 abstract methods (not more, not less)
  - [ ] Has `sortEmbeddings()` optional hook with default implementation
  - [ ] Template method `doEmbed()` calls hooks in correct order
  - [ ] Error handling wraps entire template in try-catch with `getUrl()`
  - [ ] JSDoc on all public/protected methods
  - [ ] No `any` types
  - [ ] `npm run type-check` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Type check passes with new base class
    Tool: Bash
    Preconditions: File created at src/base-embedding-model-strategy.ts
    Steps:
      1. Run: npm run type-check
      2. Check exit code is 0
      3. Verify no errors mentioning base-embedding-model-strategy.ts
    Expected Result: Exit code 0, no type errors
    Failure Indicators: Non-zero exit code, TypeScript errors in output
    Evidence: .sisyphus/evidence/task-1-typecheck.txt

  Scenario: Base class structure matches reference pattern
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run: grep -c "abstract class BaseEmbeddingModelStrategy" src/base-embedding-model-strategy.ts
      2. Run: grep -c "protected abstract" src/base-embedding-model-strategy.ts
      3. Run: grep -c "implements EmbeddingModelAPIStrategy" src/base-embedding-model-strategy.ts
    Expected Result: Line 1 returns "1", Line 2 returns "6", Line 3 returns "1"
    Failure Indicators: Any grep returning 0 or different count
    Evidence: .sisyphus/evidence/task-1-structure-check.txt

  Scenario: No forbidden patterns
    Tool: Bash
    Preconditions: File created
    Steps:
      1. Run: grep -c ": any" src/base-embedding-model-strategy.ts || echo "0"
      2. Run: grep -c "@ts-ignore" src/base-embedding-model-strategy.ts || echo "0"
    Expected Result: Both return "0"
    Failure Indicators: Non-zero count for either
    Evidence: .sisyphus/evidence/task-1-forbidden-patterns.txt
  ```

  **Commit**: YES (commit 1)
  - Message: `feat(embedding): add BaseEmbeddingModelStrategy abstract base class`
  - Files: `src/base-embedding-model-strategy.ts`
  - Pre-commit: `npm run type-check`

---

- [x] 2. Refactor OrchestrationEmbeddingModelStrategy to Extend Base Class

  **What to do**:
  - Modify `src/orchestration-embedding-model-strategy.ts` to extend `BaseEmbeddingModelStrategy`
  - Remove duplicate code now in base class:
    - Remove `doEmbed()` template logic (keep only hook implementations)
    - Remove imports moved to base class
  - Implement abstract methods:
    - `createClient()` - Create OrchestrationEmbeddingClient with config
    - `executeCall()` - Call `client.embed()` with values and embeddingType
    - `extractEmbeddings()` - Extract embeddings from response with sorting by index
    - `extractTokenCount()` - Call `response.getTokenUsage().total_tokens`
    - `getUrl()` - Return `'sap-ai:orchestration/embeddings'`
    - `getModelId()` - Return config.modelId
  - Override `sortEmbeddings()` - Sort by `.index` property (unique to Orchestration)
  - Keep Orchestration-specific logic:
    - `MaskingModule` handling via settings passthrough
    - `embeddingType` parameter handling
  - Target: ~70 lines (down from 119)

  **Must NOT do**:
  - Do NOT change the public API or behavior
  - Do NOT modify error messages or URLs
  - Do NOT change how MaskingModule is handled

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward refactoring with clear pattern to follow
  - **Skills**: `[]`
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed until commit phase

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 3)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `src/orchestration-language-model-strategy.ts:1-50` - How Orchestration language model extends base class - copy this inheritance pattern
  - `src/base-embedding-model-strategy.ts` (from Task 1) - The base class being extended

  **Implementation References** (current code to refactor):
  - `src/orchestration-embedding-model-strategy.ts:1-119` - FULL FILE: Current implementation to refactor
  - `src/orchestration-embedding-model-strategy.ts:42-93` - Current `doEmbed()` to split into hook implementations
  - `src/orchestration-embedding-model-strategy.ts:71-77` - Embedding extraction with sorting by index - becomes `extractEmbeddings()` + `sortEmbeddings()`
  - `src/orchestration-embedding-model-strategy.ts:72-73` - Token extraction (`response.getTokenUsage()`) - becomes `extractTokenCount()`

  **Type References**:
  - `@sap-ai-sdk/orchestration:OrchestrationEmbeddingClient` - Client type for generic parameter
  - `@sap-ai-sdk/orchestration:EmbeddingResponse` - Response type for generic parameter

  **WHY Each Reference Matters**:
  - Current implementation shows exactly what logic to extract into hook methods
  - Language model strategy shows the pattern for extending base classes in this codebase
  - The sorting by `.index` is unique to Orchestration - must be preserved in override

  **Acceptance Criteria**:
  - [ ] Class extends `BaseEmbeddingModelStrategy<OrchestrationEmbeddingClient, EmbeddingResponse>`
  - [ ] All 6 abstract methods implemented
  - [ ] `sortEmbeddings()` overridden with index-based sorting
  - [ ] No duplicate code from base class
  - [ ] `npm run test` passes (all existing tests green)
  - [ ] File is ~70 lines or less

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All tests pass after refactoring
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: npm run test 2>&1
      2. Check exit code is 0
      3. Verify output contains "Tests passed" or equivalent success message
    Expected Result: Exit code 0, all tests pass
    Failure Indicators: Non-zero exit code, test failures in output
    Evidence: .sisyphus/evidence/task-2-tests.txt

  Scenario: Class extends correct base
    Tool: Bash
    Preconditions: File refactored
    Steps:
      1. Run: grep "extends BaseEmbeddingModelStrategy" src/orchestration-embedding-model-strategy.ts
      2. Verify output contains the extends clause
    Expected Result: grep finds the extends clause
    Failure Indicators: No output from grep
    Evidence: .sisyphus/evidence/task-2-extends.txt

  Scenario: File size reduced
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: wc -l src/orchestration-embedding-model-strategy.ts
      2. Extract line count
    Expected Result: Line count ≤ 80
    Failure Indicators: Line count > 80
    Evidence: .sisyphus/evidence/task-2-linecount.txt

  Scenario: Index-based sorting preserved
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: grep -A5 "sortEmbeddings" src/orchestration-embedding-model-strategy.ts
      2. Verify output contains sorting logic with ".index"
    Expected Result: sortEmbeddings override exists with index sorting
    Failure Indicators: No sortEmbeddings override or no .index reference
    Evidence: .sisyphus/evidence/task-2-sorting.txt
  ```

  **Commit**: YES (commit 2)
  - Message: `refactor(embedding): OrchestrationEmbeddingModelStrategy extends base`
  - Files: `src/orchestration-embedding-model-strategy.ts`
  - Pre-commit: `npm run test`

---

- [x] 3. Refactor FoundationModelsEmbeddingModelStrategy to Extend Base Class

  **What to do**:
  - Modify `src/foundation-models-embedding-model-strategy.ts` to extend `BaseEmbeddingModelStrategy`
  - Remove duplicate code now in base class:
    - Remove `doEmbed()` template logic (keep only hook implementations)
    - Remove imports moved to base class
  - Implement abstract methods:
    - `createClient()` - Create AzureOpenAiEmbeddingClient with config
    - `executeCall()` - Build request with `buildRequest()`, call `client.run()`
    - `extractEmbeddings()` - Extract embeddings from `response.getEmbeddings()`
    - `extractTokenCount()` - Return `response._data.usage.total_tokens`
    - `getUrl()` - Return `'sap-ai:foundation-models/embeddings'`
    - `getModelId()` - Return config.modelId
  - Keep `buildRequest()` as private helper (unique to Foundation Models)
  - Do NOT override `sortEmbeddings()` (use default no-op)
  - Target: ~60 lines (down from 104)

  **Must NOT do**:
  - Do NOT change the public API or behavior
  - Do NOT modify error messages or URLs
  - Do NOT change `buildRequest()` logic

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward refactoring with clear pattern to follow
  - **Skills**: `[]`
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed until commit phase

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 2)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References** (existing code to follow):
  - `src/foundation-models-language-model-strategy.ts:1-50` - How FM language model extends base class - copy this inheritance pattern
  - `src/base-embedding-model-strategy.ts` (from Task 1) - The base class being extended

  **Implementation References** (current code to refactor):
  - `src/foundation-models-embedding-model-strategy.ts:1-104` - FULL FILE: Current implementation to refactor
  - `src/foundation-models-embedding-model-strategy.ts:41-79` - Current `doEmbed()` to split into hook implementations
  - `src/foundation-models-embedding-model-strategy.ts:81-95` - `buildRequest()` method - keep as private helper
  - `src/foundation-models-embedding-model-strategy.ts:60` - Token extraction via `response._data.usage` - becomes `extractTokenCount()`

  **Type References**:
  - `@sap-ai-sdk/foundation-models:AzureOpenAiEmbeddingClient` - Client type for generic parameter
  - `@sap-ai-sdk/foundation-models:AzureOpenAiEmbeddingResponse` - Response type for generic parameter

  **WHY Each Reference Matters**:
  - Current implementation shows exactly what logic to extract into hook methods
  - `buildRequest()` is unique to Foundation Models - keep it as private method
  - Token extraction uses internal `._data.usage` path - must be preserved exactly

  **Acceptance Criteria**:
  - [ ] Class extends `BaseEmbeddingModelStrategy<AzureOpenAiEmbeddingClient, AzureOpenAiEmbeddingResponse>`
  - [ ] All 6 abstract methods implemented
  - [ ] `sortEmbeddings()` NOT overridden (uses base default)
  - [ ] `buildRequest()` remains as private helper
  - [ ] No duplicate code from base class
  - [ ] `npm run test` passes (all existing tests green)
  - [ ] File is ~65 lines or less

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: All tests pass after refactoring
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: npm run test 2>&1
      2. Check exit code is 0
      3. Verify output contains success message
    Expected Result: Exit code 0, all tests pass
    Failure Indicators: Non-zero exit code, test failures in output
    Evidence: .sisyphus/evidence/task-3-tests.txt

  Scenario: Class extends correct base
    Tool: Bash
    Preconditions: File refactored
    Steps:
      1. Run: grep "extends BaseEmbeddingModelStrategy" src/foundation-models-embedding-model-strategy.ts
      2. Verify output contains the extends clause
    Expected Result: grep finds the extends clause
    Failure Indicators: No output from grep
    Evidence: .sisyphus/evidence/task-3-extends.txt

  Scenario: File size reduced
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: wc -l src/foundation-models-embedding-model-strategy.ts
      2. Extract line count
    Expected Result: Line count ≤ 70
    Failure Indicators: Line count > 70
    Evidence: .sisyphus/evidence/task-3-linecount.txt

  Scenario: buildRequest preserved
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: grep -c "private buildRequest" src/foundation-models-embedding-model-strategy.ts
    Expected Result: Returns "1"
    Failure Indicators: Returns "0"
    Evidence: .sisyphus/evidence/task-3-buildrequest.txt

  Scenario: No sortEmbeddings override
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: grep -c "sortEmbeddings" src/foundation-models-embedding-model-strategy.ts || echo "0"
    Expected Result: Returns "0" (no override needed)
    Failure Indicators: Returns non-zero (unnecessary override added)
    Evidence: .sisyphus/evidence/task-3-no-sort.txt
  ```

  **Commit**: YES (commit 3)
  - Message: `refactor(embedding): FoundationModelsEmbeddingModelStrategy extends base`
  - Files: `src/foundation-models-embedding-model-strategy.ts`
  - Pre-commit: `npm run test`

---

- [x] 4. Update Exports and Verify Integration

  **What to do**:
  - Update `src/index.ts` to export `BaseEmbeddingModelStrategy` (if it should be public) OR verify it's marked `@internal`
  - Run full build to verify all imports resolve correctly
  - Run full test suite to verify no regressions
  - Verify total LOC for all 3 files ≤ 230 lines

  **Must NOT do**:
  - Do NOT change any other exports
  - Do NOT modify `sap-ai-strategy.ts`
  - Do NOT modify `sap-ai-embedding-model.ts`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple verification task
  - **Skills**: `[]`
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (integration)
  - **Blocks**: Task 5
  - **Blocked By**: Tasks 2, 3

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References**:
  - `src/index.ts:1-50` - Current exports pattern - follow same style
  - `src/index.ts` - Check if `BaseLanguageModelStrategy` is exported (for consistency)

  **Files to Verify Unchanged**:
  - `src/sap-ai-strategy.ts` - Strategy factory must work unchanged
  - `src/sap-ai-embedding-model.ts` - Consumer must work unchanged

  **WHY Each Reference Matters**:
  - Export pattern should be consistent with existing base class exports
  - Consumer files should not need changes - this validates the refactoring is backward compatible

  **Acceptance Criteria**:
  - [ ] `npm run build` passes
  - [ ] `npm run check-build` passes
  - [ ] `npm run test && npm run test:node && npm run test:edge` all pass
  - [ ] `npm run lint` passes
  - [ ] Total LOC ≤ 230: `wc -l src/base-embedding-model-strategy.ts src/orchestration-embedding-model-strategy.ts src/foundation-models-embedding-model-strategy.ts`
  - [ ] `src/sap-ai-strategy.ts` unchanged (git diff shows no changes)
  - [ ] `src/sap-ai-embedding-model.ts` unchanged (git diff shows no changes)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full build succeeds
    Tool: Bash
    Preconditions: All refactoring complete
    Steps:
      1. Run: npm run build 2>&1
      2. Run: npm run check-build 2>&1
      3. Check both exit codes are 0
    Expected Result: Both commands succeed with exit code 0
    Failure Indicators: Non-zero exit code, build errors
    Evidence: .sisyphus/evidence/task-4-build.txt

  Scenario: Full test suite passes
    Tool: Bash
    Preconditions: Build succeeds
    Steps:
      1. Run: npm run test 2>&1
      2. Run: npm run test:node 2>&1
      3. Run: npm run test:edge 2>&1
      4. Check all exit codes are 0
    Expected Result: All tests pass
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-4-tests.txt

  Scenario: Line count within budget
    Tool: Bash
    Preconditions: All files finalized
    Steps:
      1. Run: wc -l src/base-embedding-model-strategy.ts src/orchestration-embedding-model-strategy.ts src/foundation-models-embedding-model-strategy.ts
      2. Sum the line counts
    Expected Result: Total ≤ 230 lines
    Failure Indicators: Total > 230 lines
    Evidence: .sisyphus/evidence/task-4-linecount.txt

  Scenario: Consumer files unchanged
    Tool: Bash
    Preconditions: Refactoring complete
    Steps:
      1. Run: git diff --name-only src/sap-ai-strategy.ts src/sap-ai-embedding-model.ts
      2. Check output is empty
    Expected Result: No output (files unchanged)
    Failure Indicators: Files appear in diff output
    Evidence: .sisyphus/evidence/task-4-unchanged.txt

  Scenario: Lint passes
    Tool: Bash
    Preconditions: All code complete
    Steps:
      1. Run: npm run lint 2>&1
      2. Check exit code is 0
    Expected Result: Exit code 0, no lint errors
    Failure Indicators: Non-zero exit code, lint errors
    Evidence: .sisyphus/evidence/task-4-lint.txt
  ```

  **Commit**: YES (commit 4)
  - Message: `chore(exports): add BaseEmbeddingModelStrategy to index`
  - Files: `src/index.ts` (if changed)
  - Pre-commit: `npm run build`

---

- [x] 5. Update ARCHITECTURE.md Documentation

  **What to do**:
  - Update `ARCHITECTURE.md` to document the new class hierarchy
  - Add section showing embedding strategy inheritance:
    ```
    EmbeddingModelAPIStrategy (interface)
    └── BaseEmbeddingModelStrategy (abstract)
        ├── OrchestrationEmbeddingModelStrategy
        └── FoundationModelsEmbeddingModelStrategy
    ```
  - Document the Template Method pattern usage
  - Update any diagrams or class lists to include the new base class
  - Ensure consistency with Language Model hierarchy documentation

  **Must NOT do**:
  - Do NOT change unrelated sections
  - Do NOT add excessive detail (match existing documentation style)

  **Recommended Agent Profile**:
  - **Category**: `writing`
    - Reason: Documentation task requiring clear technical writing
  - **Skills**: `[]`
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - None

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (documentation)
  - **Blocks**: Final verification
  - **Blocked By**: Task 4

  **References** (CRITICAL - Be Exhaustive):

  **Pattern References**:
  - `ARCHITECTURE.md` - FULL FILE: Current documentation to update
  - `ARCHITECTURE.md` section on Language Model hierarchy - Match this style for Embedding Model section

  **Content References**:
  - `src/base-embedding-model-strategy.ts` (from Task 1) - Document the abstract methods and template pattern

  **WHY Each Reference Matters**:
  - Documentation should be consistent in style and depth with existing content
  - Language Model hierarchy section is the template for Embedding Model hierarchy section

  **Acceptance Criteria**:
  - [ ] Embedding strategy hierarchy documented
  - [ ] Template Method pattern mentioned
  - [ ] Class diagram/list updated to include `BaseEmbeddingModelStrategy`
  - [ ] Consistent with Language Model documentation style
  - [ ] No unrelated changes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Hierarchy documented
    Tool: Bash
    Preconditions: Documentation updated
    Steps:
      1. Run: grep -c "BaseEmbeddingModelStrategy" ARCHITECTURE.md
    Expected Result: Returns ≥ 1 (class mentioned)
    Failure Indicators: Returns "0"
    Evidence: .sisyphus/evidence/task-5-hierarchy.txt

  Scenario: Template Method mentioned
    Tool: Bash
    Preconditions: Documentation updated
    Steps:
      1. Run: grep -i "template" ARCHITECTURE.md | grep -i "embed"
    Expected Result: Finds mention of template pattern in embedding context
    Failure Indicators: No match
    Evidence: .sisyphus/evidence/task-5-template.txt

  Scenario: Only ARCHITECTURE.md changed
    Tool: Bash
    Preconditions: Task complete
    Steps:
      1. Run: git diff --name-only
      2. Verify only ARCHITECTURE.md appears (for this task)
    Expected Result: Only ARCHITECTURE.md in diff
    Failure Indicators: Other files changed
    Evidence: .sisyphus/evidence/task-5-scope.txt
  ```

  **Commit**: YES (commit 5)
  - Message: `docs: update ARCHITECTURE.md with embedding strategy hierarchy`
  - Files: `ARCHITECTURE.md`
  - Pre-commit: none

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `npm run build` + `npm run lint` + `npm run test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp).
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Full Test Suite QA** — `unspecified-high`
      Run complete test suite: `npm run test && npm run test:node && npm run test:edge`. Verify no regressions. Check that embedding-specific tests still exercise both strategies. Compare test output before/after (if baseline available).
      Output: `Test Suites [N/N pass] | Tests [N/N pass] | Coverage [maintained/reduced] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (git diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Commit | Message                                                                    | Files                                               | Pre-commit           |
| ------ | -------------------------------------------------------------------------- | --------------------------------------------------- | -------------------- |
| 1      | `feat(embedding): add BaseEmbeddingModelStrategy abstract base class`      | `src/base-embedding-model-strategy.ts`              | `npm run type-check` |
| 2      | `refactor(embedding): OrchestrationEmbeddingModelStrategy extends base`    | `src/orchestration-embedding-model-strategy.ts`     | `npm run test`       |
| 3      | `refactor(embedding): FoundationModelsEmbeddingModelStrategy extends base` | `src/foundation-models-embedding-model-strategy.ts` | `npm run test`       |
| 4      | `chore(exports): add BaseEmbeddingModelStrategy to index`                  | `src/index.ts`                                      | `npm run build`      |
| 5      | `docs: update ARCHITECTURE.md with embedding strategy hierarchy`           | `ARCHITECTURE.md`                                   | -                    |

---

## Success Criteria

### Verification Commands

```bash
npm run build          # Expected: exit 0, no errors
npm run check-build    # Expected: exit 0
npm run test           # Expected: all tests pass
npm run lint           # Expected: no errors, no new warnings
wc -l src/base-embedding-model-strategy.ts src/orchestration-embedding-model-strategy.ts src/foundation-models-embedding-model-strategy.ts
                       # Expected: total ≤ 230 lines
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] No type errors
- [ ] Documentation updated
- [ ] Class hierarchy symmetric with Language Model pattern
