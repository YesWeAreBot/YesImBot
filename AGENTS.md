# Athena Agent Guide

## External File Loading

CRITICAL: When you encounter an `@path` reference below, use the Read tool to load it only when it is relevant to the current task.

- Do not preemptively load every referenced file.
- Loaded references are mandatory instructions for that task area and override defaults.
- Follow nested references recursively when needed.
- `.opencode/opencode.json` intentionally loads only this file; keep task-specific rules and repo context lazy-loaded from here.

## Context Files

Load these repo-specific context files on demand:

- General repo facts for every task: `@.opencode/context/general-guidelines.md`
- Exact commands, CI order, and focused verification: `@.opencode/context/workspace-commands.md`
- Runtime entrypoints, service boundaries, and extension wiring: `@.opencode/context/runtime-architecture.md`
- Repo-specific coding conventions and change-impact gotchas: `@.opencode/context/repo-conventions.md`
- External reference repos and docs: `@.opencode/context/external-references.md`

## Development Guidelines

- For TypeScript/JavaScript coding style: `@.opencode/rules/typescript/coding-style.md`
- For testing strategy and focused verification: `@.opencode/rules/typescript/testing.md` and `@.opencode/rules/common/testing.md`
- For code review tasks: `@.opencode/rules/common/code-review.md`
- For git commit / PR workflow: `@.opencode/rules/common/git-workflow.md`
- For security-sensitive changes: `@.opencode/rules/common/security.md` and `@.opencode/rules/typescript/security.md`

## General Guidelines

Read the following file immediately as it is relevant to all workflows: `@.opencode/context/general-guidelines.md`

### File Editing

- When updating or creating long files, write them in smaller chunks instead of one large write.
- Prefer segmented writes for large content because the write tool can time out on oversized payloads.
