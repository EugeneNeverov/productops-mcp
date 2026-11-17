# Spike: Atlassian Rovo remote MCP as the Jira data source (option D)

Date: 2026-11-17 · Context: decision record [`docs/decisions/0002-jira-via-atlassian-mcp.md`](../decisions/0002-jira-via-atlassian-mcp.md) · Client: [`scripts/spike-atlassian-mcp.mjs`](../../scripts/spike-atlassian-mcp.mjs) · Test data: [`scripts/seed-jira-demo.mjs`](../../scripts/seed-jira-demo.mjs)

Run on a Windows PC with the maintainer's own Atlassian account, because the cloud CI/dev environment cannot reach `mcp.atlassian.com`.

## Verdict

**Partial yes: viable for v0.2 for the core sprint snapshot. Sprint scope change needs a derived method plus one caveat.**

- A plain Node MCP client (`@modelcontextprotocol/client` 2.4.0) connects to `https://mcp.atlassian.com/v2/mcp`. The SDK's built-in `OAuthClientProvider` handles the OAuth flow: DCR as a public client, PKCE S256, loopback redirect. No Atlassian app registration or secret is needed.
- **It works on the Jira Free plan.** The site is a brand-new free Jira Cloud site. Every read succeeded, and none of the responses mentioned credits, rate limits or plan restrictions.
- Everything sprint-health-audit needs is reachable read-only: board, sprints with start/end dates, sprint issues with status category, story points, the Flagged field, issue type, assignee and created date, plus the full changelog with timestamps. That includes Sprint field changes and status transitions.
- Gaps: there is no sprint-report or scope-change operation, so scope change must be rebuilt from each issue's changelog (one call per issue). Status category comes back as a localized name when `fields` is given. `resolutiondate` was not returned. Details below.

## Environment

|          |                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| OS       | Windows 10 Pro 10.0.19045                                                                                                     |
| Node     | v26.13.1 (npm 11.20.0, git 2.56; pnpm not installed)                                                                          |
| SDK      | `@modelcontextprotocol/client@2.4.0` (exact), `zod`; no fallback to SDK 1.x needed                                            |
| Endpoint | `https://mcp.atlassian.com/v2/mcp` (Streamable HTTP). v1 was not needed: the protected-resource metadata advertises `/v2/mcp` |
| Jira     | New free Jira Cloud site; company-managed Scrum project, board #2; UI language Russian                                        |

## Auth flow

- The first request gets a 401. The SDK then discovers the protected-resource and authorization-server metadata, registers a public client (DCR, `token_endpoint_auth_method: none`), and opens the browser with a PKCE S256 authorization URL. Windows opens it with `start ""`. The callback lands on `http://127.0.0.1:33418/callback`, where the script checks `state`; `transport.finishAuth(params)` then reconnects.
- Result: **success.** Connect, including the consent wait, took 9.7 s. tools/list took 172 ms.
- Attempt 1 timed out (5 min) because no Jira site existed yet. The v1 fallback then failed with `Protected resource https://mcp.atlassian.com/v2/mcp does not match expected https://mcp.atlassian.com/v1/mcp (or origin)`, which confirms v2 is the canonical resource.
- Tokens, DCR client info and the PKCE verifier were cached in a local gitignored `.secrets/oauth.json` and never printed.

## Server

- `serverInfo`: `atlassian-mcp-server` 1.0.0, with a 192×192 PNG icon (data URI).
- Capabilities: `tools.listChanged: true`, `logging`. No resources or prompts.
- Server `instructions` (2435 chars) describe three layers:
  1. **Primary tools.** 26 are listed. The Jira read ones are `getJiraIssue`, `searchJiraIssuesUsingJql` and `listJiraIssueComments`.
  2. **`discover({query})`.** It searches about 415 operations across Jira, Confluence, Compass, Bitbucket, Loom, Goals and more. It returns `results[]` of `{name, description, product, executeTool, executeCall, inputs[], views}` (up to 5 with full input specs), followed by an "also matched (N more)" text list. The text list is appended after the JSON, so clients must split it off before `JSON.parse`.
  3. **Execute tools, chosen by risk tier:** `executeRead | executeWrite | executeDestructive`, each called as `{ name, cloudId, inputs, responseFields?, view? }`. `cloudId` is a top-level argument, not inside `inputs`.
- `cloudId` accepts the UUID, the hostname or a URL. Custom fields only appear with `view: evidence|full` or an explicit `fields` list, and then under `fields.customFields` as `{ "<display name>": { id, value } }`.

**So yes, the board and sprint tools are deferred** behind `discover`/`executeRead`. Ops used: `listJiraBoards`, `listJiraBoardSprints`, `getJiraBoardSprintData`, `listJiraIssueChangelogs`. Example: `executeRead({ cloudId, name: "listJiraBoardSprints", inputs: { boardId: 2, state: "all" } })`.

## Tool inventory (tools/list, 26 tools)

ro = `readOnlyHint`, destr = `destructiveHint`. "#in" = number of input properties. Descriptions trimmed. None of the tools declares an `outputSchema`; every result is JSON inside a single `text` content item.

| tool                            | ro    | destr | #in | required                                                            | description                                                                                                           |
| ------------------------------- | ----- | ----- | --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| getAccessibleAtlassianResources | true  | false | 0   |                                                                     | Returns the cloudId(s) available to the current user. Not needed when the user gives a Jira or Confluence link        |
| atlassianUserInfo               | true  | false | 0   |                                                                     | Returns the accountId of the current user                                                                             |
| getConfluenceContent            | true  | false | 6   | cloudId                                                             | Read any Confluence content (page, b…                                                                                 |
| createConfluenceContent         | false | false | 8   | cloudId, parent, contentType, title                                 | Create a new Confluence page, blog post, live doc, whiteboard, database, embed, smart link, or folder                 |
| updateConfluenceContent         | false | false | 14  | cloudId                                                             | Update Confluence docs, whiteboards, or databases                                                                     |
| searchConfluence                | true  | false | 6   | cloudId, cql                                                        | Search Confluence content with CQL                                                                                    |
| getJiraIssue                    | true  | false | 11  | cloudId, issueIdOrKey                                               | Get a Jira or JSM issue by key or ID… (`expand: changelog` returns only the newest page; use listJiraIssueChangelogs) |
| listJiraIssueComments           | true  | false | 9   | cloudId, issueIdOrKey                                               | Get a paginated list of comments for a Jira issue                                                                     |
| searchJiraIssuesUsingJql        | true  | false | 9   | cloudId, jql                                                        | Search for Jira issues using JQL, with an optional approximate count. Use view: "evidence" to fetch custom fields     |
| createJiraIssue                 | false | false | 12  | cloudId, projectKey, summary, issueType                             | Create a new Jira issue                                                                                               |
| editJiraIssue                   | false | false | 13  | cloudId, issueIdOrKey                                               | Edit an existing Jira issue                                                                                           |
| transitionJiraIssue             | false | false | 11  | cloudId, issueIdOrKey                                               | Move a Jira issue through its workflow and/or into a sprint or the backlog                                            |
| addOrEditJiraIssueComment       | false | false | 11  | cloudId, issueIdOrKey                                               | Add a comment to a Jira issue, or edit an existing one                                                                |
| getLoomObjectsContent           | true  | false | 4   | cloudId, identifiers                                                | Read one or more known Loom objects                                                                                   |
| getGraphContext                 | true  | false | 9   | cloudId, objectType, objectIdentifier                               | Retrieves connected context from Teamwork Graph for any Atlassian entity (incl. JiraSprint, JiraWorkItem)             |
| getGraphObject                  | true  | false | 2   | cloudId, objects                                                    | Fetches the entire available data for up to 25 objects by ARI or URL                                                  |
| addGraphContext                 | false | false | 5   | cloudId, relationshipType, objectIdentifier, targetObjectIdentifier | Adds a relationship between two entities in the Teamwork Graph                                                        |
| getCollaborators                | true  | false | 5   | cloudId                                                             | (Beta) Find a person's strongest collaborators                                                                        |
| getPeopleInfo                   | true  | false | 6   | cloudId                                                             | (Beta) Get people's profiles and reporting relationships                                                              |
| getWorkActivity                 | true  | false | 21  | cloudId                                                             | (Beta) Get authored or selected work activity for up to 10 people                                                     |
| getWorkPortfolio                | true  | false | 15  | cloudId                                                             | (Beta) Returns native and inferred projects, owned goals, and focus areas                                             |
| discover                        | true  | false | 1   | query                                                               | Find Atlassian operations that are not already in your tool list (~415 ops)                                           |
| executeRead                     | true  | false | 5   | name                                                                | Run a read-only Atlassian operation by name                                                                           |
| executeWrite                    | false | false | 5   | name                                                                | Run a write operation by name (creates or updates, non-destructive)                                                   |
| executeDestructive              | false | true  | 5   | name                                                                | Run a destructive operation by name                                                                                   |
| search                          | true  | false | 4   | cloudId, query                                                      | Semantically search Jira, Confluence, and connected third-party content using Rovo Search                             |

Write tools are annotated `readOnlyHint: false`, which makes a client-side allow-list possible. The spike client refuses anything that isn't read-only by annotation and by name. The committed version also allow-lists the op names `executeRead` may run, because that tool is annotated read-only whatever op it is given.

## Per-call results (12 tool calls in total, all read-only, no errors)

| #   | tool (op)                                             | argument shape                                                                                                                        | latency ms | bytes  | pagination                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | getAccessibleAtlassianResources                       | `{}`                                                                                                                                  | 237        | 863    | none. Returns `data.resources[] {cloudId, url, products[14] {id, access}}`                                                                                                                                                                           |
| 2   | discover                                              | `{query}` ("list sprints of a jira board")                                                                                            | 253        | 15 614 | top 5 with full inputs, then "also matched (15 more)" text                                                                                                                                                                                           |
| 3   | discover                                              | `{query}` ("get jira issue changelog history")                                                                                        | 122        | 5 305  | same                                                                                                                                                                                                                                                 |
| 4   | executeRead `listJiraBoards`                          | `{cloudId, name, inputs:{projectKeyOrId}}`                                                                                            | 684        | 381    | `startAt/maxResults/total/isLast`. Board type `scrum`                                                                                                                                                                                                |
| 5   | executeRead `listJiraBoardSprints`                    | `inputs:{boardId:2, state:"all"}`                                                                                                     | 483        | 448    | `startAt/maxResults/total/isLast`. 2 sprints, `{id, state, name, startDate, endDate, originBoardId, goal}`                                                                                                                                           |
| 6   | executeRead `getJiraBoardSprintData`                  | `inputs:{boardId:"2", sprintId:"2"}`                                                                                                  | 1 238      | 7 661  | none. Returns board, resolvedSprint, sprints[], **sprintMetrics** (total/done/inProgress/todo/unassigned/atRisk/completion%), atRiskIssues[] with riskReasons[], issues[13] (key, status + statusCategory.key, assignee, priority, created, updated) |
| 7   | searchJiraIssuesUsingJql                              | `{cloudId, jql, maxResults:10, fields:[status, issuetype, assignee, created, resolutiondate, labels, customfield_10016/10020/10021]}` | 606        | 7 348  | `nextPageToken` + `isLast:false`                                                                                                                                                                                                                     |
| 8   | searchJiraIssuesUsingJql (page 2)                     | same + `nextPageToken`                                                                                                                | 702        | 2 253  | `isLast:true`, 3 issues                                                                                                                                                                                                                              |
| 9   | executeRead `listJiraIssueChangelogs` (flagged issue) | `inputs:{issueIdOrKey, maxResults:50}`                                                                                                | 281        | 1 177  | `startAt/maxResults/total/isLast`, oldest-first, max 50 per page                                                                                                                                                                                     |
| 10  | executeRead `listJiraIssueChangelogs` (added issue)   | same                                                                                                                                  | 312        | 490    | same                                                                                                                                                                                                                                                 |
| 11  | executeRead `listJiraIssueChangelogs` (removed issue) | same                                                                                                                                  | 306        | 840    | same                                                                                                                                                                                                                                                 |
| 12  | discover                                              | `{query}` ("sprint report with issues added and removed")                                                                             | 147        | 17 155 | no sprint-report op exists; best matches are the ops above plus `manageJiraSprint` (destructive)                                                                                                                                                     |

Latency: median about 300 ms, 1.2 s for the aggregated sprint op. No `_meta`, no rate-limit headers in tool results, and no credit or usage information in any response.

Issue shape from the JQL call, with values redacted: `{ id, key, fields: { status: { name: <localized, 6 chars>, statusCategory: { name: <localized> } }, assignee: null, issuetype: { name: <localized, 7 chars> }, created, labels[1], customFields: { "Story point estimate": { id: "customfield_10016", value: <number> }, "Спринт": { id: "customfield_10020", value: [{ id, name, state, boardId, goal, startDate, endDate }] }, "Flagged": { id: "customfield_10021", value?: [{ value: "Impediment", id }] } } } }`.

Changelog entry shape: `{ created, author: <present>, items: [{ field, from, fromString, to, toString }] }`. `fieldtype`/`fieldId` were not returned. Fields seen: `Sprint` (from/to = sprint ids), `status` (from/to = status ids plus localized names), `Flagged`.

## Seeded facts and whether the MCP shows them

The demo sprint "PO Demo Sprint 1" was seeded with `scripts/seed-jira-demo.mjs` (commit 938e488) through Jira REST with an API token. That was the only write, and nothing was written through the MCP.

| seeded fact                                            | visible via MCP?         | how                                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12 issues at start, then +2 added, −1 removed (13 now) | **yes, with derivation** | `sprintMetrics.totalIssues = 13`. Added issue's changelog has `Sprint: [] → 2`. Removed issue's changelog has `Sprint: [] → 2` followed by `Sprint: 2 → []`, both timestamped |
| 4 done                                                 | yes                      | sprintMetrics.doneIssues = 4. JQL statusCategory agrees                                                                                                                       |
| 3 in progress + 1 flagged                              | yes                      | inProgressIssues = 4 (the flagged one is also in progress). `Flagged` custom field value `Impediment` on exactly 1 issue, and a `Flagged` changelog entry with timestamp      |
| 3 bugs without estimates                               | yes                      | Bugs come back with no `Story point estimate` value (only 1 of the 3 bugs is in the sprint). Every story has a numeric value                                                  |
| status transitions with timestamps                     | yes                      | changelog `status` items                                                                                                                                                      |
| story points                                           | yes                      | via `fields:[customfield_10016]` or `view: evidence`; site-specific id, discoverable by name                                                                                  |

**Caveat found:** in the changelogs, the "added after start" and "removed after start" events are timestamped _before_ the sprint's `startDate`. The cause is that the seed script sent the local machine's clock as `startDate`, and the PC was **about 16 s ahead** of Atlassian's server clock (measured against the `Date` header). So a naive "changed after startDate" rule would miss the seeded scope creep on this dataset. This is a property of the test data, not of the MCP. Fixed in the seed script (commit 3819e90): the start date is now Jira's `serverTime` minus 60 s. The audit should still tolerate small clock skew.

## Gaps for sprint-health-audit

1. **No sprint report or scope-change op.** There is no equivalent of the Greenhopper sprint report ("issues added after start / punted"). Scope change has to be rebuilt from `listJiraIssueChangelogs`: one call per sprint issue, plus the removed issues, which no longer match `sprint = N`. Finding removed issues needs JQL `sprint was N` or similar (not tested). Expect about N+3 calls per audit.
2. **Status category key is missing** when JQL is run with an explicit `fields` list. Only the localized `statusCategory.name` came back. `getJiraBoardSprintData` does return `statusCategory.key` (`done` / `indeterminate` / `new`), so either use that op or add `view: "evidence"`.
3. **`resolutiondate` was not returned**, even though it was requested in `fields`. Possibly the MCP drops it, or the workflow didn't set a resolution. Cycle time can use the changelog transition to the done category instead.
4. **Localized names everywhere:** issue types (История/Баг/Эпик), statuses, and the Sprint field's display name ("Спринт") as the `customFields` key. Key custom fields by `id`, not display name, and use category keys rather than names.
5. **No blocked-ness beyond Flagged.** "Blocked" status or link types would need `getJiraIssue` / link ops; not tested.
6. **Changelog items lack `fieldtype`/`fieldId`,** so match on `field` name (`Sprint`, `status`, `Flagged`). These appeared in English even though the UI is Russian.
7. `getJiraIssue` with `expand: changelog` only returns the newest page and the tool says so itself. Use `listJiraIssueChangelogs`.

## Seed script notes

- Commit 4a68ca6 failed on the Russian-localized site: `Issue type "epic" not found in KAN. Available: Эпик, Subtask, Задача, История, Feature, Баг`. Commit 938e488 (untranslatedName plus story points by schema.custom) works.
- A Kanban project (board type `simple`, no story points field) is correctly refused. A company-managed Scrum project worked; it uses the field "Story point estimate", `customfield_10016`.

## Errors (verbatim, redacted)

- `Endpoint https://mcp.atlassian.com/v2/mcp failed: Error: Timed out waiting for OAuth callback (5 min)`, while no site existed yet.
- `Endpoint https://mcp.atlassian.com/v1/mcp failed: Error: Protected resource https://mcp.atlassian.com/v2/mcp does not match expected https://mcp.atlassian.com/v1/mcp (or origin)`
- No errors from MCP tool calls.

## Rovo credits

None of the responses carried credit or usage information. After the spike, the Atlassian admin Rovo usage page (checked 2026-11-17, a few minutes after the calls) showed **0 credits used** for these 12 read-only calls on the Free plan. Usage reporting may lag, so recheck later before treating this as final.

## Local-only artifacts (not committed)

Tool metadata (`inventory.json`), redacted per-call metrics (`calls.jsonl`), raw responses with demo Jira data, and the OAuth/API-token cache stayed on the spike machine and are not part of the repository.
