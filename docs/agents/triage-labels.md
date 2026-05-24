# Triage Labels

Labels are stored in each issue file's YAML frontmatter under `labels:`.

| Role | Label string | Meaning |
|------|-------------|---------|
| Triage queue | `needs-triage` | Maintainer needs to evaluate |
| Waiting on reporter | `needs-info` | Waiting on reporter for more details |
| Agent-ready | `ready-for-agent` | Fully specified, an AFK agent can pick it up |
| Human-needed | `ready-for-human` | Needs human implementation |
| Won't fix | `wontfix` | Will not be actioned |

## Usage

When the `triage` skill processes an issue, it reads the current labels and transitions the issue through the state machine:

```
needs-triage → needs-info → ready-for-agent / ready-human / wontfix
```

An issue can only be picked up by an automated agent when labeled `ready-for-agent`.
