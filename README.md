# Athena (YesImBot v4)

Koishi 4.x plugin monorepo for building personality-driven LLM chat agents.

## Documentation Index

- Project working context: `AGENTS.md`
- Roadmap: `ROADMAP.md`
- Vision & evolution notes: `docs/2026-05-04-athena-v4-vision-and-evolution-notes.md`
- Design specs: `docs/superpowers/specs/`
- Implementation plans: `docs/superpowers/plans/`

## Workspace Layout

- `core/`: main runtime plugin and services
- `packages/agent/`: agent loop, session management, extension system
- `packages/shared-model/`: shared model/provider types
- `providers/`: model provider integrations
- `references/`: previous versions and design references

## Common Commands

```bash
yarn build
yarn check-types
yarn test
yarn turbo run test --filter=koishi-plugin-yesimbot
yarn turbo run check-types --filter=@yesimbot/agent
yarn lint
```
