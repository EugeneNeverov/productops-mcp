# Using productops-jira with your Jira Cloud site

`productops-jira` reads Jira through Atlassian's official remote MCP server (`https://mcp.atlassian.com/v2/mcp`, see [ADR 0002](decisions/0002-jira-via-atlassian-mcp.md)). Everything it does is read-only.

## 1. Sign in once

```sh
npx productops-jira login
```

Your browser opens the Atlassian consent page. Sign in, pick your site and approve. The command registers a public OAuth client (no secret), uses PKCE, and receives the code on `http://127.0.0.1:33418/callback`, so that port must be free while you sign in.

Credentials are saved to `~/.productops/atlassian-oauth.json` (or `$PRODUCTOPS_HOME/atlassian-oauth.json`), written atomically and readable only by you. They never appear in logs or tool output. `productops-jira status` shows whether you are signed in; `productops-jira logout` deletes the file. Storing them in the OS keychain is planned.

## 2. Start the server in live mode

Set `PRODUCTOPS_JIRA_MODE=live` in your MCP client's server config (or `"jira": { "mode": "live" }` in `productops.config.json`). Without it the server uses the bundled demo data.

If the sign-in expires or is revoked, tools return `AUTH_EXPIRED` and ask you to run `productops-jira login` again. The server never opens a browser itself.

## Cost and limits

Every upstream call may spend **Rovo credits** on your Atlassian plan. Each result reports `meta.source.upstreamCalls`. A sprint costs about 1 board call + 1 search call per 50 issues + 1 changelog call per issue; `assess_sprint_health` reads the sprint plus the baseline sprints. A tool stops before reading when its estimate exceeds `jira.budget.maxCallsPerTool` (default 600) and returns `QUOTA_BUDGET_EXCEEDED`. The spike measured 0 credits for 12 read calls on the Free plan, but plans and usage reporting differ.

## Configuration (`productops.config.json`)

```jsonc
{
  "jira": {
    "mode": "live",
    "sites": ["your-site.atlassian.net"], // empty = first accessible site
    "projects": { "allow": ["*"], "deny": [] },
    "budget": { "maxCallsPerTool": 600 },
    "people": "displayName", // or "hashed" / "none"
    "blockedStatuses": ["Blocked"],
    "fields": { "storyPoints": "customfield_10016" }, // optional; found by name otherwise
  },
}
```

## Known gaps (live mode)

- Issues removed from a sprint are not listed yet, so `SCOPE_CREEP` counts added work only (warning `REMOVED_ITEMS_UNKNOWN`).
- Status categories of statuses that only appear in changelogs are learned from other issues, or guessed from the status name (warning `UNKNOWN_STATUS_CATEGORY`).
- Responses are not cached yet; a SQLite cache is the next step.
