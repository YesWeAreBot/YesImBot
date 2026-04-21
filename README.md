# Athena (YesImBot v4)

Koishi 4.x plugin monorepo for building personality-driven LLM chat agents.

## Documentation Index

- Project constitution: `.specify/memory/constitution.md`
- Project working context: `AGENTS.md`
- Architecture overview: `.planning/codebase/ARCHITECTURE.md`
- Codebase conventions: `.planning/codebase/CONVENTIONS.md`
- Testing patterns: `.planning/codebase/TESTING.md`
- Milestone and roadmap context: `.planning/PROJECT.md`, `.planning/ROADMAP.md`

## Workspace Layout

- `core/`: main runtime plugin and services
- `packages/shared-model/`: shared model/provider types
- `providers/`: model provider integrations
- `plugins/`: optional extensions
- `references/`: previous versions and design references

## Common Commands

```bash
yarn build
yarn typecheck
yarn test
yarn turbo run test --filter=koishi-plugin-yesimbot
yarn turbo run check-types --filter=@yesimbot/plugin-sdk
yarn lint
```
