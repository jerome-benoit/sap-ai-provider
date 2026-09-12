# Contributing to SAP AI Provider

We love your input! We want to make contributing to SAP AI Provider as easy and
transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## Table of Contents

- [Development Process](#development-process)
- [Development Setup](#development-setup)
  - [Prerequisites](#prerequisites)
  - [Initial Setup](#initial-setup)
  - [Development Workflow](#development-workflow)
  - [Pre-Commit Checklist](#pre-commit-checklist)
  - [Git Hooks (Lefthook)](#git-hooks-lefthook)
- [Pull Request Process](#pull-request-process)
  - [Versioning](#versioning)
- [Coding Standards](#coding-standards)
  - [TypeScript](#typescript)
  - [Code Style](#code-style)
  - [Testing](#testing)
  - [Error Handling](#error-handling)
  - [Documentation](#documentation)
- [Testing Guidelines](#testing-guidelines)
  - [Unit Tests](#unit-tests)
  - [Integration Tests](#integration-tests)
  - [Test Coverage](#test-coverage)
- [Architecture Guidelines](#architecture-guidelines)
  - [Provider Integration](#provider-integration)
  - [Performance](#performance)
  - [Security](#security)
- [Advanced: Detailed Developer Instructions](#advanced-detailed-developer-instructions)
- [Report Bugs](#report-bugs)
- [Request Features](#request-features)
- [License](#license)
- [Code of Conduct](#code-of-conduct)
  - [Our Standards](#our-standards)
  - [Unacceptable Behavior](#unacceptable-behavior)
- [Getting Help](#getting-help)
- [Recognition](#recognition)

## Development Process

We use GitHub to host code, to track issues and feature requests, as well as
accept pull requests.

1. Fork the repo and create your branch from `main`
2. If you've added code that should be tested, add tests
3. If you've changed APIs, update the documentation
4. Ensure the test suite passes
5. Make sure your code lints
6. Issue that pull request!

## Development Setup

### Prerequisites

- Node.js 22.12 or higher
- npm or yarn
- Git
- SAP AI Core service key (for testing with real API)

### Initial Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/YOUR-USERNAME/sap-ai-provider.git
   cd sap-ai-provider
   ```

2. **Install dependencies**

   ```bash
   npm install  # or npm ci if package-lock.json exists
   ```

3. **Set up environment variables** (optional, for testing)

   ```bash
   # Create .env file
   cp .env.example .env

   # Edit .env and add your AICORE_SERVICE_KEY
   ```

4. **Verify installation**

   ```bash
   npm run build
   npm test
   ```

### Development Workflow

Our development workflow follows these steps:

1. **Make your changes** in `/src` directory
   - Follow existing code style and patterns
   - Add JSDoc comments for public APIs
   - Keep components focused and single-purpose

2. **Run type checking**

   ```bash
   npm run type-check
   ```

3. **Run tests**

   ```bash
   npm test              # Run all tests
   npm run test:node     # Node.js environment
   npm run test:edge     # Source tests in the Edge runtime VM
   npm run test:watch    # Watch mode for development
   ```

   The Edge VM suite exercises source behavior with mocked SAP dependencies;
   it is not a deployment test of the published package. ESM output uses Node
   `module.createRequire`, and SAP dependencies require Node APIs. Use Node.js
   22.12+ for supported deployments.

4. **Check code formatting**

   ```bash
   npm run prettier-check  # Check formatting
   npm run prettier-fix    # Auto-fix formatting
   ```

5. **Lint your code**

   ```bash
   npm run lint           # Check for issues
   npm run lint-fix       # Auto-fix issues
   ```

6. **Build the library**

   ```bash
   npm run build
   npm run check-build    # Verify outputs
   ```

7. **Test with examples** (requires SAP credentials)

   ```bash
   npx tsx examples/example-generate-text.ts
   ```

### Pre-Commit Checklist

The git hooks (see below) automatically handle formatting and linting on commit,
and type-check + tests on push. For a full validation before opening a PR
(including build), run:

```bash
npm run type-check && \
npm run test && \
npm run test:node && \
npm run test:edge && \
npm run prettier-check && \
npm run lint && \
npm run build && \
npm run check-build && \
npm run build:v2 && \
npm run check-build:v2
```

CI runs these checks on Node.js 24, including the Node.js and Edge VM suites.
`build:v2` replaces `dist/`, so rerun `npm run build` before using or packaging
the main package afterward.

### Git Hooks (Lefthook)

This project uses [lefthook](https://github.com/evilmartians/lefthook) to enforce
code quality automatically via git hooks. Hooks are installed automatically when you
run `npm install` (via the `prepare` lifecycle script).

**Pre-commit hook** (runs on every `git commit`):

- **Prettier** — auto-formats staged files (`--write`)
- **Markdownlint** — auto-fixes staged `.md` files (`--fix`)
- **ESLint** — auto-fixes staged TS/JS files (`--fix`)
- Fixed files are automatically re-staged into the commit
- If an unfixable error is found, the commit is blocked

**Pre-push hook** (runs on every `git push`):

- **TypeScript type-check** — full project `tsc --noEmit`
- **Tests** — full test suite via `vitest run`
- If either fails, the push is blocked

**Bypassing hooks** (use sparingly, e.g., WIP commits):

```bash
git commit --no-verify    # Skip pre-commit hook
git push --no-verify      # Skip pre-push hook
LEFTHOOK=0 git commit     # Disable lefthook entirely for one command
```

**Local overrides**: Create a `lefthook-local.yml` at the project root to override
or extend hooks for your local environment. This file is gitignored.

## Pull Request Process

1. **Update documentation** - Update README.md, API_REFERENCE.md, or other docs
   if you've changed the API
2. **Follow commit conventions** - Use
   [Conventional Commits](https://www.conventionalcommits.org/) format:
   - `feat:` for new features
   - `fix:` for bug fixes
   - `docs:` for documentation changes
   - `test:` for test additions/changes
   - `refactor:` for code refactoring
   - `chore:` for maintenance tasks
3. **Add tests** - All new features and bug fixes must include tests
4. **Request review** - The PR will be merged once you have the sign-off of at
   least one maintainer

### Versioning

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (x.0.0): Breaking changes
- **MINOR** (0.x.0): New features, backwards compatible
- **PATCH** (0.0.x): Bug fixes, backwards compatible

Version bumping is handled by maintainers during release process.

## Coding Standards

### TypeScript

- Use strict TypeScript configuration
- Prefer explicit types over `any`
- Add JSDoc comments to all public APIs
- Export types that are part of public API
- Use `zod` schemas for runtime validation

### Code Style

- 2 spaces for indentation (no tabs)
- Follow existing code patterns
- Use meaningful variable and function names
- Keep functions small and focused
- Avoid deep nesting (max 3 levels)

### Testing

- Write unit tests for all new functionality
- Run both the Node.js suite and source-level Edge VM suite
- Use descriptive test names
- Cover error cases and edge cases
- Mock external dependencies appropriately

### Error Handling

- Use Vercel AI SDK standard errors (`APICallError`, `LoadAPIKeyError`, `NoSuchModelError`, `UnsupportedFunctionalityError`)
- Use the provider's `UnsupportedFeatureError` and `ApiSwitchError` for API-specific configuration conflicts
- Provide clear, actionable error messages
- Include debugging context (request IDs, locations)
- Follow existing error patterns

### Documentation

- JSDoc comments for all public functions, classes, and interfaces
- Include `@example` blocks for complex APIs
- Update README.md for user-facing changes
- Update API_REFERENCE.md for API changes
- Keep documentation concise and precise

#### Documentation Guidelines

When adding new features or changing APIs, follow these guidelines to maintain
documentation quality:

<!-- markdownlint-disable MD036 -->

**1. Single Source of Truth**

Each piece of information should have ONE authoritative location:

- **API details** → `API_REFERENCE.md`
- **Setup instructions** → `ENVIRONMENT_SETUP.md`
- **Error solutions** → `TROUBLESHOOTING.md`
- **Architecture decisions** → `ARCHITECTURE.md`
- **Breaking changes** → `MIGRATION_GUIDE.md`
- **Quick start** → `README.md` (with links to detailed docs)

**2. Avoid Duplication**

When referencing information from another doc, use links instead of copying:

```markdown
<!-- ❌ BAD: Duplicating content -->

To set up authentication, create a service key in SAP BTP...

<!-- ✅ GOOD: Linking to source of truth -->

See [Environment Setup Guide](./ENVIRONMENT_SETUP.md#quick-setup-local-development) for
authentication setup.
```

**3. Update Checklist for New Features**

- [ ] Add to `API_REFERENCE.md` with TypeScript signatures and examples
- [ ] Update `README.md` if user-facing (keep concise, link to API_REFERENCE)
- [ ] Create example in `examples/` directory if significant feature
- [ ] Update `MIGRATION_GUIDE.md` if breaking change
- [ ] Run `npm run build` to ensure TypeScript compiles

**4. Example Code Guidelines**

- Use relative imports (`../src/index-v4`) for repo examples to match the
  installed AI SDK 7 development dependency. The root V3 import and its identical
  `/v3` subpath target AI SDK 6; `/v2` targets AI SDK 5 and also
  supports AI SDK 6 compatibility.
- Add comment explaining production import path:

  ```typescript
  // NOTE: This example uses relative imports for local development
  // In your AI SDK 7 project, use: import { ... } from "@jerome-benoit/sap-ai-provider/v4"
  ```

**5. Documentation Verification**

Before submitting a PR, run:

```bash
npm run build         # Builds three artifact families for root, /v2, /v3, /v4
npm test             # Runs test suite
```

<!-- markdownlint-enable MD036 -->

## Testing Guidelines

### Unit Tests

- Located in `*.test.ts` files alongside source
- Use Vitest as test framework
- Mock SAP AI SDK calls for offline testing
- Test both success and error paths

### Integration Tests

- Real SAP SDK contract tests use local HTTP fixtures without credentials and
  run in the Node.js CI suite (`*.node.test.ts`).
- Optional live SAP tenant smoke tests require `AICORE_SERVICE_KEY` or a service
  binding; run them only in an appropriately configured environment.

### Test Coverage

- Run `npm run test:coverage` to enforce the 90% thresholds for branches,
  functions, lines, and statements configured in `vitest.node.config.ts`.
  CI runs the normal test suites, not this coverage check.
- Focus on critical paths and error handling
- Don't test trivial getters/setters

## Architecture Guidelines

### Provider Integration

- Implement the matching Vercel AI SDK contracts: V3 root and `/v3` for SDK 6,
  V2 facade for SDK 5 (and SDK 6 compatibility), V4 facade for SDK 7. Both facades
  share the V3 core; the main package exposes four entrypoints backed by three
  artifact families. The root and `/v3` map to the same `index.*` runtime and
  declaration files, not separate builds.
- Follow the separation: provider factory → language model
- Maintain Node.js 22.12+ compatibility and source-level Edge VM coverage;
  do not equate the latter with pure Edge deployment support
- Use existing authentication patterns

### Performance

- Streaming responses must be efficient
- Avoid blocking operations in request/response flow
- Consider memory usage for large responses
- Use caching where appropriate

### Security

- Never expose service keys or tokens in logs
- Validate all external inputs with zod schemas
- Follow secure credential handling patterns
- Check for injection vulnerabilities

## Advanced: Detailed Developer Instructions

For comprehensive developer workflow and best practices, see
[`.github/copilot-instructions.md`](./.github/copilot-instructions.md). This
file contains:

- Detailed build and test procedures
- CI/CD pipeline information
- Code review guidelines
- Troubleshooting common development issues

## Report Bugs

We use GitHub issues to track bugs. Report a bug by
[opening a new issue](https://github.com/jerome-benoit/sap-ai-provider/issues/new?template=bug_report.md).

**Great Bug Reports** include:

- Quick summary and background
- Steps to reproduce (be specific!)
- Sample code if possible
- What you expected vs. what actually happened
- Notes on what you tried that didn't work

## Request Features

Request features by
[opening a feature request](https://github.com/jerome-benoit/sap-ai-provider/issues/new?template=feature_report.md).

**Good Feature Requests** include:

- Clear description of the problem to solve
- Proposed solution with examples
- Alternatives you've considered
- Any additional context or screenshots

## License

By contributing, you agree that your contributions will be licensed under the
Apache License 2.0.

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on what's best for the community
- Show empathy towards others
- Accept constructive criticism gracefully

### Unacceptable Behavior

- Harassment, discrimination, or offensive comments
- Trolling, insulting, or derogatory remarks
- Publishing others' private information
- Other conduct inappropriate in a professional setting

## Getting Help

- 📖 Read the documentation: [README](./README.md),
  [API Reference](./API_REFERENCE.md)
- 🐛 Report issues or ask questions:
  [Issue Tracker](https://github.com/jerome-benoit/sap-ai-provider/issues)
- 👥 Join the community and share your experience

## Recognition

Contributors will be recognized in:

- GitHub contributors page
- Release notes for significant contributions
- Project README (for major features)

Thank you for contributing to SAP AI Provider! 🎉

---

This document was adapted from open-source contribution guidelines and is
licensed under CC-BY-4.0.
