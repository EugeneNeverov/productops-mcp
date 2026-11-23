# Directory listings

Where the servers are listed, and what to submit.

| Directory                                                                           | Status (2026-11-18)                                                                                                                                                                               | Files in this repo                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Official MCP Registry](https://registry.modelcontextprotocol.io)                   | Published by the release workflow (both servers, active)                                                                                                                                          | `packages/*/server.json`, `mcpName` in `packages/*/package.json` |
| [GitHub MCP Registry](https://github.com/mcp), [PulseMCP](https://www.pulsemcp.com) | Pick servers up from the official registry; nothing to submit                                                                                                                                     | none                                                             |
| [Claude directory](https://claude.ai/directory/manage)                              | Blocked: local (stdio) MCP servers are accepted only from Verified organizations. The plugin is distributed through this repository's own marketplace instead (`.claude-plugin/marketplace.json`) | `plugin/`, `.claude-plugin/marketplace.json`, `PRIVACY.md`       |
| [ChatGPT plugins](https://platform.openai.com/plugins)                              | Not submitted: MCP plugins need a remote HTTPS server; ours run locally                                                                                                                           | none                                                             |
| [Smithery](https://smithery.ai)                                                     | Optional: **Publish server** → base directory `packages/mcp-prioritization` or `packages/mcp-jira`                                                                                                | `packages/*/smithery.yaml`                                       |
| [Glama](https://glama.ai/mcp/servers)                                               | Now part of Arcade.dev; no submission planned                                                                                                                                                     | `glama.json`                                                     |
| [mcp.so](https://mcp.so)                                                            | Paid listing only; skipped                                                                                                                                                                        | none                                                             |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)              | Not submitted yet: a pull request from the owner's account adding one line (text below)                                                                                                           | none                                                             |
| [mcpservers.org](https://mcpservers.org)                                            | Not submitted yet: free submission form on the site                                                                                                                                               | none                                                             |

## Search visibility

On 2026-11-23 a web search for "productops-mcp" or "ProductOps MCP server" did not show this repository; it showed similar projects instead. The repository went public on 2026-11-17, so search engines have had little time, and the GitHub page had no description or topics. What helps, in order of effect:

1. **GitHub repository settings** (owner only, gear icon next to About):
   - Description: `ProductOps MCP servers for product managers: RICE/WSJF prioritization and read-only Jira sprint health audits. Local, offline demo data, works with Claude, Cursor, LM Studio.`
   - Website: `https://www.npmjs.com/package/@productops-mcp/prioritization`
   - Topics: `mcp`, `mcp-server`, `model-context-protocol`, `product-management`, `product-ops`, `prioritization`, `rice`, `wsjf`, `roadmap`, `jira`, `scrum`, `sprint`, `agile`, `claude`, `claude-code`, `ai-agents`
   - Or from a machine with the GitHub CLI: `gh repo edit EugeneNeverov/productops-mcp --description "…" --homepage "…" --add-topic mcp,mcp-server,model-context-protocol,product-management,product-ops,prioritization,rice,wsjf,roadmap,jira,scrum,sprint,agile,claude,claude-code,ai-agents`
2. **Links from pages search engines already crawl**: the awesome-mcp-servers list, mcpservers.org, Smithery, and the launch post (Habr, LinkedIn). Each link from an indexed page speeds up indexing of the repository.
3. **Google Search Console** is not available for github.com pages, so there is nothing to submit there; links are the way in.

One line for awesome-mcp-servers (TypeScript, local):

```
- [EugeneNeverov/productops-mcp](https://github.com/EugeneNeverov/productops-mcp) 📇 🏠 - ProductOps MCP servers for product managers: RICE/WSJF backlog prioritization with capacity scenarios, and read-only Jira sprint health (cycle time, blockers, scope creep). Ships demo data.
```

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
