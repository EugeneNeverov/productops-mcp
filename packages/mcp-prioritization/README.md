# @productops-mcp/prioritization

Local MCP server for product prioritization: RICE, WSJF, method comparison and capacity scenarios. It works fully offline, the numbers are computed by code, and the model only explains them.

Part of [productops-mcp](https://github.com/EugeneNeverov/productops-mcp).

## Install

Requires Node.js 20 or newer. Add the server to your MCP client:

```json
{
  "mcpServers": {
    "productops-prioritization": {
      "command": "npx",
      "args": ["-y", "@productops-mcp/prioritization"]
    }
  }
}
```

Claude Code: `claude mcp add productops-prioritization -- npx -y @productops-mcp/prioritization`

## Tools

| Tool                  | What it does                                                                   |
| --------------------- | ------------------------------------------------------------------------------ |
| `calculate_rice`      | Reach × Impact × Confidence ÷ Effort, ranked, with the formula for every score |
| `calculate_wsjf`      | Cost of Delay ÷ Job Size (SAFe), ranked                                        |
| `compare_initiatives` | Ranks with RICE, WSJF or custom weights and shows where the methods disagree   |
| `simulate_capacity`   | Fits the ranked backlog into team capacity, respecting dependencies and musts  |
| `explain_ranking`     | Explains why one initiative ranks above another, factor by factor              |
| `triumvirate_brief`   | Optional: writes briefs for three independent judges (dev, business, product)  |
| `triumvirate_verdict` | Optional: merges the judges; strong disagreements come back to you, not a mean |

The prompt `roadmap-prioritization` turns these results into a recommendation: what to take, what to defer and why.

**Triumvirate (optional).** Instead of one formula, three judges score the backlog independently: engineering, business and marketing, and product. The server writes a brief for each judge; your client runs each brief as a separate agent (a subagent, a new chat or a local model) and passes the three answers to `triumvirate_verdict`. Items the judges agree on are ranked; items they disagree on are listed with each judge's argument for you to decide. The prompt `triumvirate-prioritization` runs the whole flow. Details: [docs/decisions/0004-triumvirate-judges.md](https://github.com/EugeneNeverov/productops-mcp/blob/main/docs/decisions/0004-triumvirate-judges.md).

## Your data

Try it first on the bundled demo backlog: ask your assistant to "rank the demo backlog with RICE". For your own backlog, point `PRODUCTOPS_DATA_DIR` at the folder with your CSV or JSON files (add `"env": { "PRODUCTOPS_DATA_DIR": "/path/to/backlogs" }` to the config above). The server reads nothing outside the allowed folders: that one, `./data` in the working directory, and any listed in `productops.config.json` (set `PRODUCTOPS_CONFIG` to its path). Column definitions: [docs/algorithms.md](https://github.com/EugeneNeverov/productops-mcp/blob/main/docs/algorithms.md).

`PRODUCTOPS_LOG_LEVEL` sets the stderr log level (`debug`, `info`, `warn`, `error`, `silent`).

## License

Apache-2.0
