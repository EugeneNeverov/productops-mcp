# ADR 0002: Jira data comes from the official Atlassian Rovo MCP server

Status: accepted, 2026-11-17 (owner's decision; spec §9.3 option D). Data-coverage spike done 2026-11-17: [docs/spikes/2026-11-17-atlassian-mcp.md](../spikes/2026-11-17-atlassian-mcp.md), verdict partial yes (see "Spike result").

## Context

A local Jira connector of our own would need an OAuth 2.0 (3LO) app. Its token endpoint needs a `client_secret`, which cannot ship in an npm package. Atlassian's policy forbids asking users to paste API tokens into third-party apps or register their own 3LO apps. The alternatives were a token broker in the cloud (option A) or a Forge app (option C). The owner chose option D: read Jira through Atlassian's own remote MCP server.

## What we verified (2026-11-17)

| Fact                                                                                                                                                                                                                                                                                                  | Source                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The server is generally available. The current endpoint is `https://mcp.atlassian.com/v2/mcp`; `/v1/mcp` and `/v1/sse` still work                                                                                                                                                                     | GitHub `atlassian/atlassian-mcp-server`, Rovo MCP changelog        |
| OAuth 2.1 with **dynamic client registration** (`/v1/register`), **public clients** (`token_endpoint_auth_methods_supported` includes `none`) and **PKCE S256**. So a local program can sign in without a client secret                                                                               | `https://mcp.atlassian.com/.well-known/oauth-authorization-server` |
| Scopes advertised include `read:jira-work`, `offline_access`                                                                                                                                                                                                                                          | `/.well-known/oauth-protected-resource`                            |
| Personal API token auth exists (`Authorization: Basic base64(email:token)`), only if the org admin enables it                                                                                                                                                                                         | "Configure authentication via API token"                           |
| Read tools cover what the metrics need: `searchJiraIssuesUsingJql`, `getJiraIssue`, `listJiraProjects`, `listJiraBoards`, `getJiraBoardConfig`, `listJiraBoardSprints`, `getJiraBoardSprintData`, `getJiraBoardIssueData`, `listJiraIssueChangelogs` ("field-change history, paginated oldest-first") | Supported tools page, updated 2026-11-02                           |
| Only "primary" tools appear in `tools/list`. Board, sprint and changelog tools are **deferred**: found with `discover`, called with `executeRead`                                                                                                                                                     | Supported tools page                                               |
| Calls consume **Rovo credits**. Monthly allowance per user: Jira Standard 25, Premium 70, Enterprise 150, pooled per org. Pay-as-you-go starts 2026-12-03                                                                                                                                             | Rovo usage limits                                                  |

**Not verified at the time of the decision** (all but rate limits were answered by the spike below). The cloud environment cannot reach `mcp.atlassian.com`, and the docs do not cover these points:

- input and output schemas of the tools;
- the exact arguments of `executeRead`;
- whether `searchJiraIssuesUsingJql` accepts `fields` / `expand=changelog`;
- the credit cost of a single Jira tool call;
- rate limits.

## Decision

`productops-jira` stays our own MCP server with the tool contracts from spec §7.3. Inside, it is an **MCP client** of the Atlassian server:

```
MCP client (LM Studio / Claude) ──stdio──▶ productops-jira ──Streamable HTTP + OAuth 2.1 (DCR, PKCE)──▶ mcp.atlassian.com/v2/mcp
                                              │ normalize → WorkItem (core/model)
                                              │ metrics in core/metrics (deterministic)
                                              └ SQLite cache + audit
```

- **Sign-in.** `productops-jira login` registers a public client through DCR. It then runs the authorization code flow with PKCE and a loopback redirect (`http://127.0.0.1:<random port>/callback`), and stores the refresh token in the OS keychain. There is no client secret, no broker and no Atlassian app of ours.
- **Optional mode.** A personal API token, for orgs whose admin enables it. This is the user's own token on their own machine, sent only to `mcp.atlassian.com`. It is not the main path.
- **Data access** sits behind a `JiraSource` interface with two implementations: `AtlassianMcpSource` (live) and `FixtureSource` (demo, evals, CI). Metrics never see which source is used.
- **Why not let the model call the Atlassian server directly** and pass the issues to our metrics tools? That would push raw issues, with untrusted text, through the model's context. It would cost many tokens, and nothing would guarantee the numbers reach the metrics unchanged. Our server keeps the data path in code.
- **Budget is counted in upstream MCP calls,** not Jira REST points. Each tool estimates its calls first: a sprint costs roughly 2 + one changelog call per issue. Over `jira.budget.maxCallsPerTool` it returns `QUOTA_BUDGET_EXCEEDED`. Closed sprints and their changelogs are cached for 7 days, because every call costs the customer credits.
- **Everything is read-only.** The OAuth scopes we request are `read:jira-work` and `offline_access`; the server also offers write tools, but our server never calls them.

## Consequences

- No cloud component of ours; the "no always-on server" principle holds.
- The Jira MCP server depends on Atlassian's tool names and output shapes. The adapter is the only place that knows them, and contract tests run on recorded responses.
- Customers pay for usage in Rovo credits. The README must say so, and the server reports `meta.source.upstreamCalls` in every result.
- Stage 4 starts with a spike on a real Jira Cloud site (owner's account, from the owner's computer). Its exit criteria:
  1. DCR and PKCE sign-in work from a Node program using `@modelcontextprotocol/client`;
  2. `executeRead` can call `listJiraBoardSprints`, `getJiraBoardSprintData` and `listJiraIssueChangelogs`;
  3. the output contains status transitions with timestamps, sprint membership changes, issue links and the flagged field;
  4. one sprint of 50 issues costs a measured number of credits.

  If point 3 or 4 fails, we fall back to option A (spec §9.3) and record that in a new ADR.

## Spike result (2026-11-17)

Run from the owner's Windows PC against a new free Jira Cloud site seeded with `scripts/seed-jira-demo.mjs`; client `scripts/spike-atlassian-mcp.mjs`. Full report: [docs/spikes/2026-11-17-atlassian-mcp.md](../spikes/2026-11-17-atlassian-mcp.md).

| Exit criterion                                            | Result                                                                                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. DCR + PKCE sign-in from `@modelcontextprotocol/client` | **Pass.** The SDK's `OAuthClientProvider` with a loopback redirect works out of the box; public client, no secret. `/v2/mcp` is the canonical resource (`/v1/mcp` is rejected by resource matching) |
| 2. `executeRead` reaches the sprint ops                   | **Pass.** `executeRead({ name, cloudId, inputs })` ran `listJiraBoards`, `listJiraBoardSprints`, `getJiraBoardSprintData`, `listJiraIssueChangelogs`                                                |
| 3. Transitions, sprint membership changes, links, flagged | **Pass except links (not tested).** Changelog has `status`, `Sprint` and `Flagged` items with timestamps; `getJiraBoardSprintData` returns `sprintMetrics` and `statusCategory.key`                 |
| 4. Measured credits per sprint                            | **Partial.** 12 read-only calls showed 0 credits on the Free plan (usage page may lag; recheck). A 50-issue sprint was not measured                                                                 |

Also works on the Jira Free plan. No rate-limit or usage data in responses; median latency ~300 ms.

Consequences for the stage 4 design:

- Scope change is derived from per-issue changelogs (no sprint-report op), so the budget estimate of "2 + one changelog call per issue" stands; removed issues need a `sprint was N` JQL query (to verify).
- Use `statusCategory.key` (from `getJiraBoardSprintData` or `view: "evidence"`), never localized names; key custom fields by id. Sites can be localized (the spike site was Russian).
- `resolutiondate` was not returned; cycle time uses the changelog transition into the done category.
- Compare changelog timestamps to sprint start with a small skew tolerance.
- `executeRead` is annotated read-only but runs whatever op `name` it is given, so the adapter allow-lists op names.

Option A is not needed. The decision stands.
