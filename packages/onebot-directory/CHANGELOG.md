# koishi-plugin-yesimbot-extension-onebot-directory

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- first release: optional OneBot directory plugin that answers group and member directory queries from a database. (#198)

### Changed
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release.
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release

### Fixed
- list refresh races and injected text in directory output. (#222)
- directory lookups respect the Koishi plugin filter scope.
- directory lookups respect the Koishi plugin filter scope