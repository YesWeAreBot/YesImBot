# @yesimbot/koishi-plugin-tts

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- multilingual configuration and localization for synthesized output.
- multilingual configuration and localization for synthesized output

### Changed
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release.
- injects the consolidated `yesimbot` core service and reads `ctx.yesimbot`; the old per-service registrations are gone, so this version pairs with the matching `koishi-plugin-yesimbot` release

### Fixed
- synthesis is serialized and in-flight tasks settle when the plugin unloads. (#229)
## [0.2.2] - 2025-09-16

### Changed

- IndexTTS2 configuration gains emotion control parameters.

## [0.2.1] - 2025-09-15

### Changed

- the adapter's stop logic and temporary directory handling were reworked.
- logging no longer depends on a standalone Logger service.

## [0.2.0] - 2025-09-14

### Changed

- the local open-audio adapter was split out, and official Fish Audio support was added.

## [0.1.0] - 2025-09-13

### Added

- Fish Audio support and an initial IndexTTS2 adapter.
