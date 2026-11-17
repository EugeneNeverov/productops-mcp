# MCP client configs

Build first: `pnpm install && pnpm build`. Replace `/ABSOLUTE/PATH/TO/productops-mcp` with your checkout path.
Once the packages are published to npm, `command: "npx"` with `args: ["-y", "@productops/mcp-prioritization"]` will work too.

| Client         | File                         | Where it goes                            |
| -------------- | ---------------------------- | ---------------------------------------- |
| LM Studio      | `lmstudio.mcp.json`          | Program tab → Install → Edit `mcp.json`  |
| Claude Desktop | `claude_desktop_config.json` | Settings → Developer → Edit Config       |
| Claude Code    | `claude-code.mcp.json`       | Copy to `.mcp.json` in your project root |

Logs go to stderr. Set `PRODUCTOPS_LOG_LEVEL` to `debug`, `info` (default), `warn`, `error` or `silent`.
