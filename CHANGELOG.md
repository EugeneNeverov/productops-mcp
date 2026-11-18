# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-11-18

### Added

- `@productops-mcp/prioritization`: optional triumvirate method. `triumvirate_brief` writes briefs for three independent judges (dev, business/marketing, product) that the client runs as separate agents; `triumvirate_verdict` merges their answers and lists strong disagreements for a human decision instead of averaging them. New prompt `triumvirate-prioritization`. RICE and WSJF stay the default ([ADR 0004](docs/decisions/0004-triumvirate-judges.md)).

### Changed

- The release workflow publishes to npm with trusted publishing (OIDC) only; the `NPM_TOKEN` secret is no longer used.

## [0.1.0] - 2026-11-18

First public release.

### Added

- `@productops-mcp/prioritization`: offline MCP server with `calculate_rice`, `calculate_wsjf`, `compare_initiatives`, `simulate_capacity` and `explain_ranking`, a demo SaaS backlog, RICE and WSJF reference resources, and the `roadmap-prioritization` prompt.
- `@productops-mcp/jira`: read-only MCP server with `list_projects`, `get_sprint_issues`, `analyze_cycle_time`, `find_blockers` and `assess_sprint_health`, a synthetic demo team, live mode through the official Atlassian MCP server (`productops-jira login`), a response cache and an audit log, and the `sprint-health-audit` prompt.
- `@productops-mcp/core`: shared schemas, tool runtime, policy, config and logging.
- Agent skills `roadmap-prioritization` and `sprint-health-audit`, with eval cases and a runner for OpenAI-compatible endpoints.
- `PRODUCTOPS_DATA_DIR` adds a folder the prioritization server may read backlog files from.
- Claude Desktop extensions (`.mcpb`) for both servers, attached to the GitHub Release.

[0.2.0]: https://github.com/EugeneNeverov/productops-mcp/releases/tag/v0.2.0
[0.1.0]: https://github.com/EugeneNeverov/productops-mcp/releases/tag/v0.1.0
