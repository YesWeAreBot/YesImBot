# Athena Environment and Configuration

Athena is configured primarily through Koishi plugin schemas, not hard-coded process env reads in core services.

## Configuration Sources

1. Koishi plugin config UI / config file (`core/src/index.ts` and plugin/provider `Config` schemas)
2. Provider configs (API key, base URL, model list)
3. Extension plugin configs (search/mcp/persona/memory-keeper)

## Core Runtime Config (YesImBot)

Defined in `core/src/index.ts`:

- Model selection and fallback chain
- Willingness and aggregation parameters
- Prompt and role/skill paths
- Context/history and image handling limits
- Timeouts and debug level

## Provider Secrets

Provider configs require secrets through schema fields (typically `apiKey`), for example:

- `providers/provider-openai`
- `providers/provider-anthropic`
- `providers/provider-google`
- `providers/provider-deepseek`

All of these use shared provider schema defaults from `packages/shared-model/src/providers/schema-factory.ts`.

## Extension Plugin Secrets

Depending on enabled plugins:

- `plugins/search-service`: requires provider API key; optional Jina key for `fetch`
- `plugins/mcp-client`: may need per-server env or headers
- `plugins/memory-keeper`: plugin-scoped settings (if enabled)

## Suggested Local Setup Checklist

1. Configure at least one model provider with valid `apiKey`.
2. Register one chat model and set `model` / `summaryModel` in yesimbot config.
3. Verify role and skill directories (`rolePath`, `skillPaths`) exist.
4. If using web search, configure search plugin keys.
5. Run `yarn typecheck` and start Koishi runtime.

## Troubleshooting

- No model available: verify provider plugin loaded and models are configured.
- Empty responses/tool failures: inspect `maxRounds`, timeout, and tool schema config.
- Missing role content: check `rolePath` and role file names (`SOUL.md`, `AGENTS.md`, `TOOLS.md`).
- MCP tool unavailable: verify server connection config and transport type.
