# productops-mcp

Open-source Product Operations toolkit built on the Model Context Protocol: local prioritization (RICE, WSJF, capacity scenarios) and Jira sprint intelligence, plus reusable agent skills. Calculations are done by code; the model only explains the results.

Status: early development. See [docs/spec-v0.1.md](docs/spec-v0.1.md) (in Russian) for the v0.1 technical specification.

## Packages

| Package                          | What it is                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@productops/core`               | Shared schemas (`Meta`, `ToolError`), tool runtime, policy, config, stderr logger                      |
| `@productops/mcp-prioritization` | Local MCP server (stdio). Stage 1 exposes only `ping`; RICE, WSJF and capacity tools arrive in stage 2 |

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
