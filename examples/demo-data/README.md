# Demo data

`saas-roadmap` is a fully synthetic backlog of 40 initiatives for a fictional B2B SaaS product: 3 teams (Growth, Platform, Mobile), 8 dependencies and 2 mandatory items. Every field is filled for both RICE and WSJF.

- File: [`packages/mcp-prioritization/demo-data/saas-roadmap.csv`](../../packages/mcp-prioritization/demo-data/saas-roadmap.csv). It ships inside the npm package, so any client can use it with `{"initiatives": {"kind": "demo"}}`.
- Generator: `node scripts/gen-demo-data.mjs` (fixed seed, reproducible).
- Reference outputs of every tool on this dataset: [`examples/reports/demo/`](../reports/demo). Regenerate them with `pnpm build && node scripts/gen-demo-reports.mjs`. The e2e suite fails if the server's output drifts from them.

Suggested capacity for a quarter: Growth 10, Platform 12, Mobile 12 person-months.
