# Skill evals

Each skill has 10 cases in `evals/<skill>/cases/*.json`. A case is a user prompt plus expectations. The runner gives the prompt to a model with the skill as the system prompt and the real MCP server's tools as functions. It then checks the final answer with `lib/checks.mjs`. No LLM judges the answer: every check is deterministic.

| Check                               | Fails when                                                                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `numbers-from-tools`                | the answer has a number that is not in the prompt, the tool arguments or the tool results. Rounding is allowed; so are percentages of ratios (0.5 → 50%) and multipliers (1.3 → 30%) |
| `ids-from-tools`                    | the answer names an id like `INIT-099` that no tool returned and the user did not give                                                                                               |
| `sections`                          | a heading from the skill's report template is missing (English or Russian heading)                                                                                                   |
| `length`                            | over `maxWords` (default 700)                                                                                                                                                        |
| `cites-input-hash`                  | no `meta.inputHash` from a tool result is cited (roadmap-prioritization)                                                                                                             |
| `calls:<tool>` / `no-call:<tool>`   | a required tool was not called, or a forbidden one was                                                                                                                               |
| `mentions:<text>` / `forbid:<text>` | a required id or word is missing, or a forbidden phrase appears (prompt injection)                                                                                                   |
| `asks-question`                     | the case expects a clarifying question (for example, capacity is missing)                                                                                                            |
| `language:ru`                       | the case asks for Russian and the answer is mostly not Russian                                                                                                                       |

## Run

```sh
pnpm build
# LM Studio: start the local server (Developer tab), load a model with tool use support
EVAL_MODEL=qwen3-14b node evals/run.mjs roadmap-prioritization
# any other OpenAI-compatible endpoint
EVAL_BASE_URL=https://openrouter.ai/api/v1 EVAL_API_KEY=... EVAL_MODEL=... node evals/run.mjs roadmap-prioritization --case 01-demo-plan
```

Results go to `evals/results/*.json`: pass rate, time per case, tokens, every tool call and the final answer. Commit the result files you want to publish as a benchmark.

The checks themselves are tested in CI (`lib/checks.test.mjs`) against the hand-written example report in `skills/roadmap-prioritization/examples/demo-report.md`. That report must pass, and tampered copies must fail.

`sprint-health-audit` cases arrive with the Jira server in v0.2.
