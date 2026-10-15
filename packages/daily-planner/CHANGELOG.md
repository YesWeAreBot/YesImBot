# koishi-plugin-yesimbot-extension-daily-planner

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release.
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release

### Fixed
- schedule generation stops on dispose, prompt injections and snippets are unregistered, per-day generation is deduplicated, and dates are formatted in local time. (#231)
## [0.1.1] - 2025-09-15

### Changed

- dropped unnecessary dependencies and cleaned up the structure.
- logging no longer depends on a standalone Logger service.
