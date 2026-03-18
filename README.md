# Athena (YesImBot v4)

Koishi 4.x plugin monorepo for building personality-driven LLM chat agents.

## Documentation Index

- Project working context: `AGENTS.md`
- Architecture overview: `docs/ARCHITECTURE.md`
- Change playbook: `docs/CHANGE_GUIDE.md`
- Config and environment notes: `docs/ENVIRONMENT.md`
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
yarn test -p core
yarn lint
```
