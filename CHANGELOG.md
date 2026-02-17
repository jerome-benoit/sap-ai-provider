# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- CHANGELOG.md for version tracking

### Fixed

- V2 publish workflow now includes `prepare:v2` step

## [4.4.11] - 2025-02-09

### Changed

- Lock file maintenance

## [4.4.10] - 2025-02-07

### Added

- V2 package availability note in README
- Harmonized cursor rules for dual-package architecture
- Updated documentation for V2 facade structure

### Fixed

- Use Record type in prepare-v2 script (lint fix)

## [4.4.9] - 2025-02-06

### Added

- V2 build to all CI workflows

### Changed

- Reorganized scripts and added smart V2 preparation

### Fixed

- Harmonized V2 publish job with V3
- Removed redundant check-build:v2 script
- V2 publish from root like V3
- Simplified prepare script for V2 publishing

## [4.4.8] - 2025-02-05

### Fixed

- V2 peerDependencies corrected to ai ^5.0.0 || ^6.0.0 (no SDK 4.x support)
- Normalize headers to filter undefined values in embedding model
- Type guard for V2 warning message access
- Removed SDK version specificity from V2 package descriptions
- Address review comments - remove dead code, fix docs, remove shebang
- Remove unnecessary NODE_AUTH_TOKEN for trusted publishing
- Restore original step names and rename jobs to publish-npm/publish-npm-v2
- Remove unnecessary registry-url for trusted publishing
- Correct SDK version in V2 package documentation

## [4.4.7] - 2025-02-04

### Added

- Dual-package architecture section to ARCHITECTURE.md
- Dual-package publishing for V2 and V3

## [4.4.6] - 2025-02-03

### Changed

- Dependency updates (typescript-eslint ^8.56.0)
- Lock file maintenance

## [4.4.5] - 2025-02-01

### Fixed

- Non-major dependency updates

## [4.4.4] - 2025-01-30

### Fixed

- Non-major dependency updates

## [4.4.3] - 2025-01-28

### Changed

- Non-major dependency updates

## [4.4.2] - 2025-01-25

### Changed

- Dependency updates (typescript-eslint ^8.55.0)

## [4.4.1] - 2025-01-23

### Changed

- Lock file maintenance

## [4.4.0] - 2025-01-20

### Added

- LanguageModelV3 and EmbeddingModelV3 implementation
- Enhanced streaming with structured V3 blocks
- Detailed token usage breakdown

### Changed

- Migrated from LanguageModelV2 to LanguageModelV3 specification
- Updated finish reason format to object structure
- Stream events now use structured blocks (text-start, text-delta, text-end)

### Breaking Changes

- `result.finishReason` is now an object (use `result.finishReason.unified`)
- `result.usage` has nested structure with detailed breakdown
- Stream parsing requires V3 block structure

## [4.3.0] - 2025-01-15

### Added

- Foundation Models API support
- API selection at provider, model, and per-call level
- `logprobs`, `seed`, `logit_bias` parameters for Foundation Models

## [4.2.0] - 2025-01-10

### Added

- Document grounding (RAG) support
- Translation module integration

## [4.1.0] - 2025-01-05

### Added

- Content filtering with Azure Content Safety and Llama Guard
- Data masking with SAP DPI integration

## [4.0.0] - 2025-01-01

### Added

- Initial V4 release with LanguageModelV3 support
- Dual API support (Orchestration and Foundation Models)
- Text embeddings support

### Changed

- Requires Vercel AI SDK 5.0+

### Breaking Changes

- See [Migration Guide](./MIGRATION_GUIDE.md#version-3x-to-4x-breaking-changes)

---

## Previous Versions

For changes in v3.x and earlier, see the
[Migration Guide](./MIGRATION_GUIDE.md#version-2x-to-3x-breaking-changes).

[unreleased]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.11...HEAD
[4.4.11]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.10...v4.4.11
[4.4.10]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.9...v4.4.10
[4.4.9]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.8...v4.4.9
[4.4.8]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.7...v4.4.8
[4.4.7]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.6...v4.4.7
[4.4.6]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.5...v4.4.6
[4.4.5]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.4...v4.4.5
[4.4.4]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.3...v4.4.4
[4.4.3]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.2...v4.4.3
[4.4.2]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.1...v4.4.2
[4.4.1]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.4.0...v4.4.1
[4.4.0]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.3.0...v4.4.0
[4.3.0]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/jerome-benoit/sap-ai-provider/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/jerome-benoit/sap-ai-provider/releases/tag/v4.0.0
