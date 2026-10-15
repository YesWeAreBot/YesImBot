# @yesimbot/koishi-plugin-mcp

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release.
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release

### Fixed
- MCP tool calls enforce deadlines and release their resources when the plugin unloads. (#230)
- the MCP command conversion switch is inherited correctly. (#213)
## [1.1.2] - 2025-09-15

### Changed

- logging no longer depends on a standalone Logger service.

## [1.1.1] - 2025-09-08

### Removed

- redundant config fields.
