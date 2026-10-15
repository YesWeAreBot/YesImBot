# @yesimbot/koishi-plugin-code2image

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release.
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release

### Fixed
- pending generation timeouts and tool registrations are released when the plugin is disposed. (#230)
## [1.1.1] - 2025-09-15

### Changed

- logging no longer depends on a standalone Logger service.
