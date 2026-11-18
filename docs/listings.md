# Directory listings

Where the servers are listed, and what to submit. Most directories read the MCP Registry or GitHub, so after a release the work is mostly a one-time submission.

| Directory                                                         | How it gets the server                                                                                                                                | Files in this repo                                               |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Official MCP Registry](https://registry.modelcontextprotocol.io) | Published by the release workflow                                                                                                                     | `packages/*/server.json`, `mcpName` in `packages/*/package.json` |
| [GitHub MCP Registry](https://github.com/mcp)                     | Mirrors the official registry                                                                                                                         | none                                                             |
| [Glama](https://glama.ai/mcp/servers)                             | Indexes public GitHub repositories; claim it with **Add server** and your GitHub account                                                              | `glama.json` (maintainers)                                       |
| [Smithery](https://smithery.ai)                                   | **Publish server** → connect the GitHub repository; publish once per server with base directory `packages/mcp-prioritization` and `packages/mcp-jira` | `packages/*/smithery.yaml`                                       |
| [mcp.so](https://mcp.so)                                          | **Submit** form (one per server)                                                                                                                      | text below                                                       |
| [PulseMCP](https://www.pulsemcp.com)                              | Picks servers up from the official registry; **Submit** form to speed it up                                                                           | text below                                                       |
| Claude Desktop                                                    | `.mcpb` files on the GitHub Release; optionally submit to the Anthropic extension directory                                                           | `packages/*/mcpb/manifest.json`                                  |

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
