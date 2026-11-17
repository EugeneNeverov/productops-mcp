# productops-mcp

Open-source Product Operations toolkit built on the Model Context Protocol: local prioritization (RICE, WSJF, capacity scenarios) and Jira sprint intelligence, plus reusable agent skills. Calculations are done by code; the model only explains the results.

Status: early development. See [docs/spec-v0.1.md](docs/spec-v0.1.md) (in Russian) for the v0.1 technical specification.

## Packages

| Package                          | What it is                                                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `@productops/core`               | Shared schemas (`Meta`, `ToolError`), tool runtime, policy, config, stderr logger                                                          |
| `@productops/mcp-prioritization` | Local MCP server (stdio), fully offline: `calculate_rice`, `calculate_wsjf`, `compare_initiatives`, `simulate_capacity`, `explain_ranking` |

## Try it

After `pnpm install && pnpm build`, ask the server to rank the bundled demo backlog:

```sh
pnpm client packages/mcp-prioritization/dist/bin.js calculate_rice '{"initiatives":{"kind":"demo"}}'
```

Your own backlog goes in a CSV or JSON file inside an allowed folder (default `./data`, configurable in `productops.config.json`). The columns match the fields in [docs/algorithms.md](docs/algorithms.md). Sample outputs are in [examples/reports/demo](examples/reports/demo).

## Skills

[`skills/roadmap-prioritization`](skills/roadmap-prioritization/SKILL.md) turns the tools into a recommendation a product manager can act on: what to take, what to defer, the trade-offs, where the methods disagree, and how to reproduce every number. It is also served as the MCP prompt `roadmap-prioritization`, so it works in clients without Agent Skills support, such as LM Studio. See [skills/README.md](skills/README.md) and an [example report](skills/roadmap-prioritization/examples/demo-report.md).

Skill quality is measured by [evals](evals/README.md): 10 cases, deterministic checks (every number and id must come from a tool), and a runner for any OpenAI-compatible endpoint, LM Studio included.

## Development

Requires Node.js ≥ 22.12 and pnpm 10 (`corepack enable`). Published packages run on Node ≥ 20.

```sh
pnpm install
pnpm test          # build, then unit + e2e tests
pnpm lint && pnpm format:check
pnpm client        # start the built server and call `ping` through a real MCP client
```

To connect a client such as LM Studio, Claude Desktop or Claude Code, see [examples/clients](examples/clients/README.md). Design decisions are recorded in [docs/decisions](docs/decisions).

## License

Apache-2.0, see [LICENSE](LICENSE). This license covers the code in this repository only. Use of third-party APIs (Atlassian Jira, Google Analytics and others) is governed by those providers' own terms.
