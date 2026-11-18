# MCP client configs

These configs run the servers from a local checkout, for development. To use the published packages instead, see [Install](../../README.md#install) (`npx -y @productops-mcp/prioritization`).

Build first: `pnpm install && pnpm build`. Replace `/ABSOLUTE/PATH/TO/productops-mcp` with your checkout path.

| Client         | File                         | Where it goes                            |
| -------------- | ---------------------------- | ---------------------------------------- |
| LM Studio      | `lmstudio.mcp.json`          | Program tab → Install → Edit `mcp.json`  |
| Claude Desktop | `claude_desktop_config.json` | Settings → Developer → Edit Config       |
| Claude Code    | `claude-code.mcp.json`       | Copy to `.mcp.json` in your project root |

Logs go to stderr. Set `PRODUCTOPS_LOG_LEVEL` to `debug`, `info` (default), `warn`, `error` or `silent`.
