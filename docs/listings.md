# Directory listings

Where the servers are listed, and what to submit.

| Directory                                                                           | Status (2026-11-18)                                                                                                                                                                                                                 | Files in this repo                                               |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Official MCP Registry](https://registry.modelcontextprotocol.io)                   | Published by the release workflow (both servers, active)                                                                                                                                                                            | `packages/*/server.json`, `mcpName` in `packages/*/package.json` |
| [GitHub MCP Registry](https://github.com/mcp), [PulseMCP](https://www.pulsemcp.com) | Pick servers up from the official registry; nothing to submit                                                                                                                                                                       | none                                                             |
| [Claude directory](https://claude.ai/directory/manage)                              | Submit the plugin bundle: **Submit new → Plugin bundle**, repository `EugeneNeverov/productops-mcp`, plugin path `plugin`. Needs a Pro, Max, Team or Enterprise account. The directory no longer accepts `.mcpb` desktop extensions | `plugin/`, `PRIVACY.md`                                          |
| [ChatGPT plugins](https://platform.openai.com/plugins)                              | Not submitted: MCP plugins need a remote HTTPS server; ours run locally                                                                                                                                                             | none                                                             |
| [Smithery](https://smithery.ai)                                                     | Optional: **Publish server** → base directory `packages/mcp-prioritization` or `packages/mcp-jira`                                                                                                                                  | `packages/*/smithery.yaml`                                       |
| [Glama](https://glama.ai/mcp/servers)                                               | Now part of Arcade.dev; no submission planned                                                                                                                                                                                       | `glama.json`                                                     |
| [mcp.so](https://mcp.so)                                                            | Paid listing only; skipped                                                                                                                                                                                                          | none                                                             |

## Submission text

**ProductOps Prioritization** (`@productops-mcp/prioritization`)

- Repository: https://github.com/EugeneNeverov/productops-mcp
- Short: Offline product prioritization: RICE, WSJF, method comparison and capacity what-if scenarios.
- Long: A local MCP server for product managers. It ranks a backlog with RICE and WSJF, shows where the methods disagree and why, fits the ranked backlog into team capacity with what-if scenarios, and explains any ranking factor by factor. Every number is computed by code and can be reproduced; the model only explains it. Ships a demo SaaS backlog and the `roadmap-prioritization` prompt. Works fully offline.
- Install: `npx -y @productops-mcp/prioritization`
- Tags: product management, prioritization, roadmap, RICE, WSJF, planning

**ProductOps Jira Sprint Health** (`@productops-mcp/jira`)

- Repository: https://github.com/EugeneNeverov/productops-mcp
- Short: Read-only Jira sprint health: cycle time, blockers, scope creep and carry-over, with demo data.
- Long: A read-only MCP server that audits Jira sprints: burndown lag, scope change, blockers, WIP per person, cycle-time regression, estimation gaps and carry-over, combined into a health score where every finding cites its issues. Starts with a synthetic demo team, so it works without a Jira account; live mode reads Jira Cloud through the official Atlassian MCP server with OAuth and PKCE, with a local cache and audit log. Includes the `sprint-health-audit` prompt.
- Install: `npx -y @productops-mcp/jira`
- Tags: jira, scrum, agile, sprint, engineering management, product ops

Icon: [`assets/icon.png`](../assets/icon.png) (512×512). Demo: [`docs/assets/demo.gif`](assets/demo.gif).
