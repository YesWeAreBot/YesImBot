# Phase 1: Foundation & Shared Model - Research

**Researched:** 2026-02-17
**Domain:** Monorepo infrastructure, TypeScript build system, Koishi plugin architecture
**Confidence:** MEDIUM-HIGH

## Summary

Phase 1 establishes a Turborepo + Yarn workspaces monorepo with three top-level directories (packages/, plugins/, providers/), a shared-model package exporting ai-sdk-based types, and a Koishi 4.x plugin skeleton. The technical stack is mature and well-documented, with clear patterns for TypeScript project references, workspace protocol dependencies, and Koishi's service injection system.

**Primary recommendation:** Use Turborepo's pipeline with TypeScript composite projects, Yarn workspace: protocol for internal dependencies, and Koishi's standard plugin structure with custom service registration for provider management.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Monorepo structure:** Three top-level directories: `packages/` (shared), `plugins/` (YesImBot extensions), `providers/` (provider plugins)
- **Package naming:** Shared packages use `@yesimbot/*` scope; Koishi plugins follow `@yesimbot/koishi-plugin-*` convention
- **Shared-model design:** Contains type definitions + basic utilities (not pure types); extends ai-sdk types without runtime dependency
- **Plugin architecture:** Single core plugin with all built-in services; providers as independent Koishi plugins supporting multiple instances
- **Provider registration:** Custom registry (not Koishi native Service), enabling same provider plugin with different configs
- **Configuration:** Distributed - core and provider plugins manage their own Koishi Config schemas
- **Adapter pattern:** Core uses independent adapter layer to interface with Koishi message events

### Claude's Discretion
- Package internal file organization
- TypeScript compilation configuration details
- Turborepo pipeline design
- Development watch/hot-reload approach

### Deferred Ideas (OUT OF SCOPE)
None specified - discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLATFORM-01 | Koishi 集成 — 作为 Koishi 4.x 插件运行，Service 注入体系，生命周期管理 | Koishi plugin structure (apply function, ctx object), service injection patterns, lifecycle hooks (ready/dispose), custom service registration for provider registry |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Turborepo | latest | Build orchestration, caching | Industry standard for monorepo task management, content-addressed caching |
| Yarn | 3.x+ | Package manager, workspaces | Native workspace protocol support, single lockfile, dependency hoisting |
| TypeScript | 5.x | Type system, compilation | Composite projects enable incremental builds, project references for monorepo |
| Koishi | 4.x | Bot framework | Target platform - plugin system, service injection, lifecycle management |
| ai-sdk | latest | Type definitions | Vercel's unified LLM abstraction (LanguageModelV1 interface) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @types/* | matching | Type definitions | For any library without native TypeScript support |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Turborepo | Nx | Nx has more features but higher complexity; Turborepo simpler for pure build orchestration |
| Yarn | pnpm | pnpm has stricter hoisting but requires careful @types configuration; Yarn more forgiving |
| ai-sdk types | Custom abstractions | ai-sdk provides battle-tested LLM interface; custom would require maintenance |

**Installation:**
```bash
# Root
yarn init -y
yarn add -D turbo typescript

# Workspaces defined in root package.json
```

## Architecture Patterns

### Recommended Project Structure
```
YesImBot/
├── packages/
│   └── shared-model/          # @yesimbot/shared-model
│       ├── src/
│       │   ├── index.ts       # Re-export types + utilities
│       │   ├── types/         # IModelProvider, IModel, ModelConfig
│       │   └── utils/         # Basic helper functions
│       ├── package.json
│       └── tsconfig.json
├── plugins/
│   └── core/                  # @yesimbot/koishi-plugin-core
│       ├── src/
│       │   ├── index.ts       # Plugin entry (apply function)
│       │   ├── services/      # ModelService, AgentCore, etc.
│       │   └── adapter/       # Koishi event adapter layer
│       ├── package.json
│       └── tsconfig.json
├── providers/
│   └── openai/                # @yesimbot/koishi-plugin-provider-openai
│       ├── src/
│       │   └── index.ts       # Provider plugin entry
│       ├── package.json
│       └── tsconfig.json
├── turbo.json
├── package.json               # Root with workspaces
├── tsconfig.base.json         # Shared TS config
└── yarn.lock
```

### Pattern 1: Turborepo Pipeline with Dependencies
**What:** Define task execution order and caching via turbo.json
**When to use:** All monorepo builds
**Example:**
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```
**Key:** `^build` means "build dependencies first"; `outputs` enables caching

### Pattern 2: TypeScript Composite Projects
**What:** Use project references for incremental builds
**When to use:** All packages in monorepo
**Example:**
```json
// tsconfig.base.json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "incremental": true,
    "moduleResolution": "NodeNext",
    "module": "NodeNext"
  }
}

// packages/shared-model/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}

// plugins/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "references": [
    { "path": "../../packages/shared-model" }
  ]
}
```

### Pattern 3: Yarn Workspace Protocol
**What:** Use `workspace:*` for internal dependencies
**When to use:** All cross-package dependencies
**Example:**
```json
// plugins/core/package.json
{
  "name": "@yesimbot/koishi-plugin-core",
  "dependencies": {
    "@yesimbot/shared-model": "workspace:*",
    "koishi": "^4.0.0"
  }
}
```
**Key:** `workspace:*` ensures local resolution, instant change reflection

### Pattern 4: Koishi Plugin Structure
**What:** Standard plugin entry with apply function
**When to use:** All Koishi plugins
**Example:**
```typescript
// Source: Koishi documentation patterns
import { Context, Schema } from 'koishi'

export const name = 'core'

export interface Config {
  // Plugin configuration
}

export const Config: Schema<Config> = Schema.object({
  // Schema definition
})

export function apply(ctx: Context, config: Config) {
  // Plugin lifecycle
  ctx.on('ready', () => {
    // Initialization after app starts
  })

  ctx.on('dispose', () => {
    // Cleanup on plugin unload
  })
}
```

### Pattern 5: Custom Service Registration (Provider Registry)
**What:** Non-Koishi-native service for multi-instance providers
**When to use:** Provider plugin registration in core
**Example:**
```typescript
// Core plugin - custom registry
class ProviderRegistry {
  private providers = new Map<string, IModelProvider>()

  register(id: string, provider: IModelProvider) {
    this.providers.set(id, provider)
  }

  get(id: string): IModelProvider | undefined {
    return this.providers.get(id)
  }
}

// In core apply function
const registry = new ProviderRegistry()
ctx.providerRegistry = registry  // Attach to context

// Provider plugin
export function apply(ctx: Context, config: ProviderConfig) {
  const provider = createOpenAIProvider(config)
  ctx.providerRegistry.register(config.id, provider)
}
```

### Anti-Patterns to Avoid
- **Using TypeScript paths without workspace protocol:** Breaks runtime resolution; use `workspace:*` instead
- **Koishi native Service for providers:** Prevents multiple instances; use custom registry
- **Centralized configuration:** Makes provider plugins non-reusable; distribute config schemas
- **Direct Koishi event handling in core:** Tight coupling; use adapter layer for isolation

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Monorepo task orchestration | Custom build scripts | Turborepo | Content-addressed caching, dependency graph, parallel execution |
| Package linking | Manual symlinks | Yarn workspaces | Automatic hoisting, single lockfile, workspace protocol |
| Incremental TypeScript builds | Watch mode scripts | TypeScript project references | Compiler-level incremental compilation, .tsbuildinfo tracking |
| LLM provider abstraction | Custom interfaces | ai-sdk types | Battle-tested, ecosystem support, standardized patterns |
| Koishi plugin loading | Custom module loader | Koishi's native system | Handles naming conventions, lifecycle, hot-reload |

**Key insight:** Monorepo tooling has matured significantly - custom solutions miss critical edge cases (cache invalidation, circular dependencies, hoisting conflicts, module resolution).

## Common Pitfalls

### Pitfall 1: TypeScript Path Aliases Without Runtime Support
**What goes wrong:** IDE resolves imports via tsconfig paths, but Node.js fails at runtime
**Why it happens:** Node.js doesn't read tsconfig.json; paths are compile-time only
**How to avoid:** Use Yarn `workspace:*` protocol for internal packages; avoid extensive path aliases
**Warning signs:** "Cannot find module" errors only at runtime, not in IDE

### Pitfall 2: Missing Turborepo Outputs Configuration
**What goes wrong:** Tasks re-run every time despite no changes
**Why it happens:** Without `outputs`, Turborepo can't cache file artifacts
**How to avoid:** Always define `outputs: ["dist/**"]` for build tasks in turbo.json
**Warning signs:** Cache shows "0 cached, X tasks" on repeated builds

### Pitfall 3: Incorrect TypeScript Module Resolution
**What goes wrong:** "Cannot find module" or "Ambiguous module declarations" errors
**Why it happens:** Mismatch between TypeScript's moduleResolution and Node.js behavior
**How to avoid:** Use `"moduleResolution": "NodeNext"` and `"module": "NodeNext"` for modern Node.js
**Warning signs:** Imports work in some packages but fail in others

### Pitfall 4: Koishi Plugin Naming Convention Violations
**What goes wrong:** Plugin not loaded by Koishi despite correct installation
**Why it happens:** Koishi expects `koishi-plugin-*` or `@scope/koishi-plugin-*` naming
**How to avoid:** Always follow naming convention; verify package.json name field
**Warning signs:** Plugin installed but not appearing in Koishi plugin list

### Pitfall 5: Building Dependent Packages Out of Order
**What goes wrong:** Consumer package fails to compile because dependency not built yet
**Why it happens:** Manual build commands don't respect dependency graph
**How to avoid:** Use `turbo run build` (respects `dependsOn: ["^build"]`), not individual package builds
**Warning signs:** "Cannot find module" for workspace dependencies during build

### Pitfall 6: Hoisting Conflicts with @types Packages
**What goes wrong:** TypeScript can't find type definitions for dependencies
**Why it happens:** Package manager hoists @types to root, but TypeScript looks locally
**How to avoid:** Explicitly declare @types packages in each workspace's package.json
**Warning signs:** "Could not find a declaration file for module" errors

### Pitfall 7: Shared-Model Runtime Dependency on ai-sdk
**What goes wrong:** Shared-model becomes heavy, forces all consumers to bundle ai-sdk runtime
**Why it happens:** Importing runtime functions instead of just types
**How to avoid:** Use `import type { ... }` for ai-sdk imports; only re-export types
**Warning signs:** Large bundle sizes, ai-sdk appearing in production dependencies

## Code Examples

### Minimal Koishi Plugin Skeleton
```typescript
// plugins/core/src/index.ts
import { Context, Schema } from 'koishi'

export const name = 'core'
export const inject = []  // No service dependencies initially

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export function apply(ctx: Context, config: Config) {
  ctx.on('ready', () => {
    ctx.logger('core').info('YesImBot core initialized')
  })
}
```

### Shared Model Type Re-exports
```typescript
// packages/shared-model/src/index.ts
// CRITICAL: Use 'import type' to avoid runtime dependency
import type { LanguageModelV1 } from 'ai'

// Re-export ai-sdk types
export type { LanguageModelV1 }

// Custom extensions
export interface IModelProvider {
  readonly id: string
  readonly name: string
  getModel(modelId: string): LanguageModelV1
}

export interface ModelConfig {
  provider: string
  model: string
  temperature?: number
}

// Utility functions (non-type exports allowed)
export function createModelId(provider: string, model: string): string {
  return `${provider}:${model}`
}
```

### Root Package.json with Workspaces
```json
{
  "name": "yesimbot-monorepo",
  "private": true,
  "packageManager": "yarn@3.6.0",
  "workspaces": [
    "packages/*",
    "plugins/*",
    "providers/*"
  ],
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "clean": "turbo run clean"
  },
  "devDependencies": {
    "turbo": "latest",
    "typescript": "^5.0.0"
  }
}
```

### Provider Plugin with Custom Registry
```typescript
// providers/openai/src/index.ts
import { Context, Schema } from 'koishi'
import { createOpenAI } from '@ai-sdk/openai'
import type { IModelProvider } from '@yesimbot/shared-model'

export const name = 'provider-openai'

export interface Config {
  id: string  // Unique instance ID
  apiKey: string
  baseURL?: string
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().required(),
  apiKey: Schema.string().role('secret').required(),
  baseURL: Schema.string()
})

export function apply(ctx: Context, config: Config) {
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  })

  const provider: IModelProvider = {
    id: config.id,
    name: 'OpenAI',
    getModel: (modelId: string) => openai(modelId)
  }

  // Register with core's custom registry
  ctx.providerRegistry.register(config.id, provider)

  ctx.on('dispose', () => {
    ctx.providerRegistry.unregister(config.id)
  })
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Lerna for monorepo | Turborepo/Nx | 2021-2022 | Better caching, simpler config, faster builds |
| npm/yarn v1 workspaces | Yarn v3+ with workspace: protocol | 2020-2021 | Explicit internal dependencies, better resolution |
| TypeScript watch mode | Project references + composite | 2019 | Incremental compilation, proper dependency tracking |
| Custom LLM abstractions | ai-sdk standard | 2023-2024 | Unified interface, ecosystem compatibility |
| Koishi v3 | Koishi v4 | 2023 | Improved plugin system, better TypeScript support |

**Deprecated/outdated:**
- **Lerna:** Still works but Turborepo/Nx preferred for new projects
- **TypeScript paths for monorepo:** Workspace protocol more reliable
- **Global Koishi services for multi-instance needs:** Custom registries required

## Open Questions

1. **Koishi Custom Service vs Context Extension**
   - What we know: Can attach custom objects to ctx
   - What's unclear: Best practice for provider registry - service-like class vs plain object
   - Recommendation: Start with simple context extension, refactor to service if lifecycle complexity grows

2. **ai-sdk Type Stability**
   - What we know: LanguageModelV1 is current interface
   - What's unclear: Breaking changes in future versions
   - Recommendation: Pin ai-sdk version in shared-model, document upgrade path

3. **Turborepo Remote Caching**
   - What we know: Supports remote cache for CI/CD
   - What's unclear: Whether needed for this project scale
   - Recommendation: Start with local cache, add remote if team grows

## Sources

### Primary (HIGH confidence)
- [Turborepo Documentation](https://turbo.build/repo/docs) - Pipeline configuration, caching mechanism
- [Koishi Documentation](https://koishi.chat) - Plugin structure, service injection, lifecycle
- [Vercel AI SDK](https://sdk.vercel.ai) - LanguageModelV1 interface, custom providers
- [TypeScript Handbook](https://typescriptlang.org) - Project references, composite configuration
- [Yarn Documentation](https://yarnpkg.com) - Workspace protocol, dependency management

### Secondary (MEDIUM confidence)
- [Turborepo monorepo setup](https://premieroctet.com) - Verified setup patterns
- [TypeScript monorepo configuration](https://moonrepo.dev) - Project references best practices
- [Koishi plugin development](https://saurlax.com) - Service injection examples

### Tertiary (LOW confidence - marked for validation)
- WebSearch results on ai-sdk types - Need official docs verification
- Community patterns for Koishi custom services - Need testing

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All tools are mature, well-documented, widely adopted
- Architecture: MEDIUM-HIGH - Patterns verified through multiple sources, some custom elements (provider registry) need validation
- Pitfalls: MEDIUM - Common issues documented in community, specific to this stack combination needs testing

**Research date:** 2026-02-17
**Valid until:** ~60 days (stable ecosystem, but ai-sdk evolving rapidly)
