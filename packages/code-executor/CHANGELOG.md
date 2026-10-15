# @yesimbot/koishi-plugin-code-executor

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot.tool`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release.
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot.tool`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release

### Fixed
- output length limits are enforced for executor results. (#214)
- pending executor timeouts and registered tools are released when the plugin is disposed. (#230)
## [1.2.1] - 2025-09-15

### Changed

- logging no longer depends on a standalone Logger service.

## [1.2.0] - 2025-09-14

### Removed

- the JavaScript executor and its `isolated-vm` dependency.
