# Issue Tracker

Issues are tracked as local markdown files under `.scratch/<feature>/` in this repo. Each issue is a `.md` file with optional YAML frontmatter for labels and status.

## Conventions

- **Create**: Write a new `.md` file under `.scratch/<feature>/` (e.g. `.scratch/workspace/fix-delete-tool.md`).
- **List**: Read the directory listing of `.scratch/` and its subdirectories.
- **Update**: Edit the corresponding `.md` file directly.
- **Close/resolve**: Remove the file or add `status: closed` to frontmatter.

## Frontmatter format

```yaml
---
labels: [needs-triage, ready-for-agent]
status: open
assignee: MiaowFISH
---
```
