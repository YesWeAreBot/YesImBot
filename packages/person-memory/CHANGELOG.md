# koishi-plugin-yesimbot-extension-person-memory

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- first release: scoped person profiles with account linking, source evidence, model-suggested candidates, administrator review, filterable review history, archiving after version confirmation and audited rollback. Profiles are injected into the context dynamically, and background summaries do not depend on vector search. (#217)
- identity evidence is recorded before the turn's inference through the core's `beforeUserStimulus` v1 event, and person recall follows the core's recall and history-clearing rules with source positions and timestamps.
- a hint stays on the profile when an identity link has changed, noting that older memories may be mixed up until the profile is reviewed again.
- identity evidence is recorded before the turn's inference through the core's `beforeUserStimulus` v1 event, and person recall follows the core's recall and history-clearing rules with source positions and timestamps
- a hint stays on the profile when an identity link has changed, noting that older memories may be mixed up until the profile is reviewed again

### Changed
- requires `koishi-plugin-yesimbot` `^3.0.4`, injects `yesimbot` and reads the core through `ctx.yesimbot`; the required capabilities are detected before registration side effects, and older cores (including 3.0.3) are reported with an upgrade hint instead of failing at registration.
- profile and audit state are written as single unique inserts, so a shared-database failure no longer rolls back writes accepted by other channels; the state cache is replayed on startup, existing databases save a migration baseline on the first commit, a cancellation before commit dispatch is honored, and a write that landed stays accepted.
- corrections re-filter saved recall summaries when the context is built, and cleared history cannot be re-injected from saved sources. (#241)
- requires `koishi-plugin-yesimbot` `^3.0.4`, injects `yesimbot` and reads the core through `ctx.yesimbot`; the required capabilities are detected before registration side effects, and older cores (including 3.0.3) are reported with an upgrade hint instead of failing at registration
- profile and audit state are written as single unique inserts, so a shared-database failure no longer rolls back writes accepted by other channels; the state cache is replayed on startup, existing databases save a migration baseline on the first commit, a cancellation before commit dispatch is honored, and a write that landed stays accepted

### Fixed
- person and directory lookups respect the Koishi plugin filter scope, keeping the existing permission limits.
- duplicate sources no longer rewrite their evidence.
- person and directory lookups respect the Koishi plugin filter scope, keeping the existing permission limits
- duplicate sources no longer rewrite their evidence