# Skills

Agent Skills (a folder with `SKILL.md`) that turn the MCP tools into repeatable product workflows. Every number in a skill's report comes from a tool; the model explains it.

| Skill                                                     | Needs                       | Status                                 |
| --------------------------------------------------------- | --------------------------- | -------------------------------------- |
| [roadmap-prioritization](roadmap-prioritization/SKILL.md) | `productops-prioritization` | v0.1                                   |
| [sprint-health-audit](sprint-health-audit/SKILL.md)       | `productops-jira`           | written; the Jira server ships in v0.2 |

## Using a skill

- **Clients with Agent Skills support** (for example Claude Code or Claude Desktop): copy the skill folder into the client's skills directory, for example `.claude/skills/roadmap-prioritization/` in a project.
- **Any MCP client, LM Studio included:** the server also serves the skill as the MCP prompt `roadmap-prioritization`, with optional arguments `source`, `capacity` and `question`. Pick it from the client's prompt list, or paste `SKILL.md` and `report-template.md` into the system prompt.

Each skill has a report template and, where available, an example report built from the demo data. Quality is measured with the evals in [`evals/`](../evals/README.md).
