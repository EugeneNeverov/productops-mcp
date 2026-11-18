# ProductOps plugin for Claude

Prioritize a product backlog and audit Jira sprints with numbers you can trust. Two local MCP servers do every calculation in code (RICE, WSJF, capacity scenarios, cycle time, blockers, sprint health score), and two skills turn their output into a recommendation a product manager can act on. Every number and issue key in Claude's answer comes from a tool.

## What's inside

| Component                              | What it does                                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `productops-prioritization` MCP server | `calculate_rice`, `calculate_wsjf`, `compare_initiatives`, `simulate_capacity`, `explain_ranking`. Fully offline. |
| `productops-jira` MCP server           | `list_projects`, `get_sprint_issues`, `analyze_cycle_time`, `find_blockers`, `assess_sprint_health`. Read-only.   |
| `roadmap-prioritization` skill         | What to take into the quarter, what to defer, the trade-offs, and where RICE and WSJF disagree.                   |
| `sprint-health-audit` skill            | Verdict, top risks with evidence, and actions for the next 48 hours.                                              |

Both servers start with demo data, so you can try the plugin without your own backlog or a Jira account.

## Install

In Claude Code (2.1.275 or later):

```
/plugin install productops --marketplace eugeneneverov/productops-mcp
```

On older versions: `/plugin marketplace add EugeneNeverov/productops-mcp`, then `/plugin install productops@productops`. Requires Node.js 20 or newer.

## How to use it

- "Rank the demo backlog with RICE and WSJF and tell me where they disagree."
- "We have 3 engineers for 12 weeks. What fits, and what if one leaves?"
- "How is the current sprint on the demo PAY board going?"

Options (set when you enable the plugin):

- **Backlog folder**: a folder with your backlog as CSV or JSON. Columns are described in [docs/algorithms.md](https://github.com/EugeneNeverov/productops-mcp/blob/main/docs/algorithms.md).
- **Jira data source**: `fixtures` (demo team, the default) or `live`. For live mode, run `npx -y @productops-mcp/jira@0.2.0 login` in a terminal once and sign in to Atlassian in your browser.

## What runs and what data it sends

- The servers are the npm packages [`@productops-mcp/prioritization`](https://www.npmjs.com/package/@productops-mcp/prioritization) and [`@productops-mcp/jira`](https://www.npmjs.com/package/@productops-mcp/jira) at a pinned version, started with `npx`. npx downloads them from the npm registry the first time.
- The prioritization server makes no network requests. It reads only files inside the backlog folder you choose.
- The Jira server in `fixtures` mode makes no network requests. In `live` mode it connects only to Atlassian: the official Atlassian MCP server (`mcp.atlassian.com`) and its OAuth sign-in. It only reads. Your sign-in, a response cache and an audit log of tool calls (no arguments or Jira content) stay on your computer in `~/.productops`.
- Nothing is sent to the plugin author. There is no telemetry.

Full details: [PRIVACY.md](https://github.com/EugeneNeverov/productops-mcp/blob/main/PRIVACY.md). Source code: [github.com/EugeneNeverov/productops-mcp](https://github.com/EugeneNeverov/productops-mcp), Apache-2.0.
