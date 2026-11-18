# Privacy policy

Last updated: 2026-11-18

productops-mcp is open-source software that runs on your computer: the MCP servers `@productops-mcp/prioritization` and `@productops-mcp/jira`, the ProductOps plugin for Claude, and the Claude Desktop extensions. The author operates no service, collects no data, and receives nothing from the software.

## What the software reads

- **Prioritization server**: backlog files (CSV or JSON) inside the folders you allow (`PRODUCTOPS_DATA_DIR`, `./data`, or `files.allowedRoots` in `productops.config.json`), plus the bundled demo data. It makes no network requests.
- **Jira server, demo mode** (`fixtures`, the default): only the bundled synthetic dataset. No network requests.
- **Jira server, live mode**: issues, sprints, boards and changelogs of the Jira Cloud sites you authorize, read through Atlassian's official remote MCP server (`https://mcp.atlassian.com`). It only reads; it never creates or changes anything in Jira.

## What is stored, and where

Only on your computer, in `~/.productops` (or `$PRODUCTOPS_HOME`), readable only by your user account:

- `atlassian-oauth.json`: your Atlassian OAuth tokens, after `productops-jira login`. Removed by `productops-jira logout`.
- `cache.db`: cached Jira responses (kept 5 minutes to 7 days depending on the data). Cleared by `productops-jira cache clear` or `logout`.
- Audit log in `cache.db`: time, tool name, a hash of the input, outcome, duration and number of upstream calls for each tool call. No arguments and no Jira content. Rows older than `audit.retentionDays` (default 30) are deleted.

## What is sent, and to whom

- To **Atlassian**, in live mode only: the read requests needed to answer your question, under your OAuth sign-in. Atlassian's own privacy policy applies, and calls may use Rovo credits on your plan.
- To the **npm registry**, when `npx` installs the packages.
- Tool results go to the AI client you connected the servers to (for example Claude). That client's privacy policy governs what happens to them.
- Nothing is sent to the author or any other third party. There is no telemetry, analytics or advertising.

## Children

The software is a professional tool and is not directed at people under 18.

## Contact

Questions or concerns: open an issue at https://github.com/EugeneNeverov/productops-mcp/issues.
