---
name: search
description: |
  Enables web search capabilities when user queries require current information,
  fact-checking, or web content lookup. Automatically activated by search intent.
lifecycle: sticky
stickyTimeout: 2
conditions:
  match:
    dimension: intent
    value: search
effects:
  tools:
    include:
      - search
      - fetch
---

## Usage Guidelines

Enable this skill when the user's query falls into these categories:

1. **Current Events & News**: Recent happenings, ongoing events, latest developments
2. **Fact-Checking**: Verifying claims, statistics, or factual statements
3. **Temporal Queries**: Information that changes over time (prices, dates, versions)
4. **Web Content**: Specific URLs, online articles, documentation references
5. **Beyond Training Data**: Topics not covered in the model's training cutoff

## Tool Usage

- **search**: Start with broad queries to find relevant sources
- **fetch**: After getting search results, use fetch to read full content from promising URLs

## Examples

```
User: "What's the latest news about OpenAI?"
→ Use search tool with query "OpenAI latest news"

User: "Is it true that Python 4.0 was released?"
→ Use search tool to verify, then fetch sources

User: "What's the current price of Bitcoin?"
→ Use search tool with query "Bitcoin price"
```
