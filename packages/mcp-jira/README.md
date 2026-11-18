# @productops-mcp/jira

Read-only MCP server for Jira sprint health: cycle time, blockers, scope creep, carry-over and a sprint health score. The metrics are computed by code, and every finding points to the issues behind it.

It ships a synthetic demo team, so you can try it without a Jira account. Live mode reads your Jira Cloud through the official Atlassian MCP server.

Part of [productops-mcp](https://github.com/EugeneNeverov/productops-mcp).

## Install

Requires Node.js 20 or newer (22.13+ for the response cache and audit log).

```json
{
  "mcpServers": {
    "productops-jira": {
      "command": "npx",
      "args": ["-y", "@productops-mcp/jira"]
    }
  }
}
```

Claude Code: `claude mcp add productops-jira -- npx -y @productops-mcp/jira`

Without further setup the server uses the demo data. Ask your assistant to "audit the demo team's current sprint".

## Your Jira Cloud

```sh
npx -y @productops-mcp/jira login
```

Then set `PRODUCTOPS_JIRA_MODE=live` in the server's `env`. Sign-in uses OAuth with PKCE; no API token is stored or asked for. Calls may spend Rovo credits on your Atlassian plan. Details: [docs/jira-live.md](https://github.com/EugeneNeverov/productops-mcp/blob/main/docs/jira-live.md).

## Tools

| Tool                   | What it does                                                         |
| ---------------------- | -------------------------------------------------------------------- |
| `list_projects`        | Projects and boards you can read                                     |
| `get_sprint_issues`    | Issues of a sprint, normalized                                       |
| `analyze_cycle_time`   | Cycle time percentiles and outliers                                  |
| `find_blockers`        | Blocked and stale issues                                             |
| `assess_sprint_health` | Health score with findings (scope creep, WIP, carry-over and others) |

The prompt `sprint-health-audit` turns the results into an audit report. Metric definitions: [docs/metrics.md](https://github.com/EugeneNeverov/productops-mcp/blob/main/docs/metrics.md).

## License

Apache-2.0
