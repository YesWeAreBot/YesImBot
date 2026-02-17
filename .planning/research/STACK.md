# Technology Stack

**Project:** Athena (YesImBot) v4
**Researched:** 2026-02-17
**Confidence:** MEDIUM (based on training data, external verification unavailable)

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Koishi | ^4.18.0 | Bot framework | Standard for multi-platform IM bots in 2025. Plugin architecture, TypeScript-first, active ecosystem. v4.x is stable with improved service injection and lifecycle management. |
| TypeScript | ^5.7.0 | Type system | Industry standard. v5.7+ has improved type inference, decorator support, and better monorepo performance. |
| Node.js | >=20.0.0 | Runtime | LTS with native ESM support, improved performance, and fetch API. Required for Koishi 4.x. |

### AI/LLM Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| ai (Vercel AI SDK) | ^4.1.0 | LLM abstraction | Unified interface for multiple providers (OpenAI, Anthropic, DeepSeek). Streaming support, tool calling, structured output. Replaces xsai with better TypeScript types and active maintenance. |
| @ai-sdk/openai | ^1.0.0 | OpenAI provider | Official provider for GPT models. |
| @ai-sdk/anthropic | ^1.0.0 | Anthropic provider | Claude models support. |

### Monorepo & Build Tools

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Turborepo | ^2.3.0 | Monorepo orchestration | Fast incremental builds, remote caching, task pipelines. Better than Nx for TypeScript-heavy projects. Handles workspace dependencies automatically. |
| Yarn | ^4.12.0 | Package manager | Modern workspace support, Plug'n'Play optional, better resolution than npm. v4.x has improved performance and zero-installs capability. |
| pkgroll | ^2.21.0 | Package bundler | Rollup-based bundler optimized for libraries. Handles dual ESM/CJS output, TypeScript declarations, and preserves source maps. Simpler than tsup for Koishi plugins. |

### TypeScript Tooling

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @types/node | ^22.0.0 | Node.js types | Match Node.js 20+ LTS. |
| typescript | ^5.7.0 | Compiler | Declaration generation only (pkgroll handles transpilation). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @satorijs/element | ^4.0.0 | JSX for messages | Template rendering for rich messages. Koishi's standard for cross-platform message formatting. |
| zod | ^3.23.0 | Schema validation | Config validation, LLM structured output parsing. Better DX than JSON Schema. |
| minato | ^3.0.0 | Database ORM | Vector storage, conversation history. Koishi's official ORM with multi-driver support (SQLite, MySQL, PostgreSQL). |
| sharp | ^0.33.0 | Image processing | Avatar generation, image manipulation for vision models. Native performance, WebP/AVIF support. |
| cosmiconfig | ^9.0.0 | Config loading | Load .yesimbotrc files. Standard for tool configuration. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| oxlint | Linting | Rust-based, 50-100x faster than ESLint. Covers most ESLint rules. |
| oxfmt | Formatting | Rust-based Prettier alternative. Faster, compatible formatting. |
| husky | Git hooks | Pre-commit validation. Standard for enforcing quality gates. |
| lint-staged | Staged file linting | Only lint changed files. Faster CI/CD. |
| bumpp | Version management | Interactive version bumping with changelog generation. |

## Installation

```bash
# Core dependencies
yarn add koishi @koishijs/plugin-console
yarn add ai @ai-sdk/openai @ai-sdk/anthropic

# Supporting libraries
yarn add @satorijs/element zod minato sharp cosmiconfig

# Dev dependencies
yarn add -D typescript @types/node
yarn add -D pkgroll turbo
yarn add -D oxlint oxfmt husky lint-staged bumpp
```

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| LLM SDK | Vercel AI SDK | LangChain | Too heavy for chat bot use case. Vercel AI SDK has better streaming and simpler API. |
| LLM SDK | Vercel AI SDK | xsai | Deprecated, unmaintained. Vercel AI SDK has broader provider support. |
| Bundler | pkgroll | tsup | pkgroll better for libraries, simpler config. tsup adds unnecessary complexity for Koishi plugins. |
| Bundler | pkgroll | esbuild directly | pkgroll wraps esbuild with better defaults for dual ESM/CJS output. |
| Monorepo | Turborepo | Nx | Turborepo simpler, faster for TypeScript. Nx overkill for plugin architecture. |
| Monorepo | Turborepo | pnpm workspaces only | Turborepo adds caching and task orchestration. Worth the dependency. |
| Package Manager | Yarn 4 | pnpm | Yarn 4 has better workspace protocol support. pnpm's symlinks can cause issues with Koishi plugins. |
| Linter | oxlint | ESLint | oxlint 50-100x faster. Covers 90% of ESLint rules. Good enough for most projects. |
| Formatter | oxfmt | Prettier | oxfmt faster, compatible output. Prettier slower in monorepos. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| LangChain | Over-engineered for chat bots. Heavy abstractions, slow updates. | Vercel AI SDK |
| xsai | Unmaintained, limited provider support. | Vercel AI SDK |
| ESLint + Prettier | Slow in monorepos (5-10s vs 100ms). | oxlint + oxfmt |
| ts-node | Slow startup, not needed with pkgroll. | Direct Node.js with pkgroll output |
| Webpack | Overkill for libraries. Slow builds. | pkgroll (Rollup-based) |
| CommonJS-only packages | Breaks ESM-first architecture. | ESM or dual-mode packages |

## Stack Patterns by Variant

**For provider plugins (OpenAI, DeepSeek, etc.):**
- Use Vercel AI SDK provider packages
- Minimal dependencies (just ai + provider)
- Export provider factory function

**For core plugin:**
- Use full stack (Koishi + ai + minato + sharp)
- Monorepo workspace dependencies
- Service injection pattern

**For utility packages:**
- Zero Koishi dependencies
- Pure TypeScript libraries
- Reusable across projects

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Koishi ^4.18.0 | Node.js >=20.0.0 | Requires native fetch API |
| ai ^4.1.0 | TypeScript ^5.0.0 | Uses advanced type features |
| pkgroll ^2.21.0 | TypeScript ^5.0.0 | Needs modern TS for declaration emit |
| Yarn 4.12.0 | Node.js >=18.12.0 | Corepack required |
| sharp ^0.33.0 | Node.js >=18.17.0 | Native bindings |

## Provider-Specific Notes

### Vercel AI SDK Providers

**OpenAI (@ai-sdk/openai):**
- GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
- Function calling, vision, streaming
- Most mature provider

**Anthropic (@ai-sdk/anthropic):**
- Claude 3 family (Opus, Sonnet, Haiku)
- Extended context windows
- Better instruction following

**Custom providers:**
- Implement LanguageModelV1 interface
- For DeepSeek, Qwen, local models
- Wrap OpenAI-compatible APIs

## Confidence Assessment

| Technology | Confidence | Source |
|------------|------------|--------|
| Koishi 4.x | HIGH | Project context shows existing v4 setup |
| TypeScript 5.7+ | HIGH | Industry standard, stable |
| Vercel AI SDK | MEDIUM | Training data, cannot verify current version |
| Turborepo | HIGH | Project context shows turbo.json exists |
| Yarn 4 | HIGH | Project context shows packageManager field |
| pkgroll | HIGH | Project context shows in devDependencies |
| oxlint/oxfmt | HIGH | Project context shows in devDependencies |
| Supporting libraries | MEDIUM | Based on training data and ecosystem patterns |

## Sources

**Project Context:**
- D:/Codespace/koishi-dev/YesWeAreBot/YesImBot/package.json — Existing setup with Turborepo, Yarn 4, pkgroll, oxlint/oxfmt
- D:/Codespace/koishi-dev/YesWeAreBot/YesImBot/tsconfig.base.json — TypeScript 5.x configuration
- D:/Codespace/koishi-dev/YesWeAreBot/YesImBot/turbo.json — Turborepo task configuration

**Training Data (January 2025 cutoff):**
- Vercel AI SDK documentation and ecosystem
- Koishi framework architecture
- TypeScript 5.x features
- Monorepo tooling landscape

**Limitations:**
- WebSearch, WebFetch, and Brave Search unavailable during research
- Version numbers based on training data (may not reflect latest releases)
- Recommend verifying versions with official sources before implementation

---
*Stack research for: AI chat agent Koishi plugin*
*Researched: 2026-02-17*
*Confidence: MEDIUM (external verification unavailable)*
