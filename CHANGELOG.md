# Changelog

All notable changes to Vault Dashboard will be documented in this file.

## Unreleased

### Added

- Added provider-specific AI settings for Cursor SDK, Codex CLI, Claude Code, and OpenRouter.
- Added macOS Keychain helpers for storing AI provider API keys outside plugin data and the public repository.
- Added security-focused tests for AI provider dispatch permissions, OpenRouter URL validation, and provider error redaction.
- Added cron config tests to ensure scheduled AI metadata does not leak API key references.

### Changed

- Kept Cursor SDK as an optional gated integration instead of a required production dependency.
- Updated AI dispatch flow to route local CLI and remote OpenRouter providers through shared record handling.
- Improved cleanup documentation and type-only imports across changed TypeScript files.
- Expanded public-repo ignore rules for local env files, key files, sqlite databases, and local secret artifacts.

### Fixed

- Fixed Codex execute dispatches so dangerous sandbox bypass flags are only used when skip-permissions is explicitly enabled.
- Fixed Keychain status checks so they do not read secret values just to report configured/not configured state.
- Fixed OpenRouter base URL handling to reject non-HTTPS URLs, embedded credentials, query strings, and fragments before attaching API keys.
- Fixed provider error handling to redact common secret formats and cap persisted diagnostic text.

### Security

- Removed the required `@cursor/sdk` dependency from the production dependency tree, clearing the runtime `npm audit --omit=dev` findings.
- Added repo-wide public-safety checks for hardcoded credentials and local secret files.
