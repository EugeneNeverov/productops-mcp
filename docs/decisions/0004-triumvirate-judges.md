# ADR 0004: Triumvirate of judges, run by the client

Status: accepted, 2026-11-18.

## Context

RICE and WSJF rank a backlog from numbers someone already entered. The user asked for an optional second method: three independent judges, one each for engineering (dev), business and marketing, and product, who score the same initiatives without seeing each other's scores. Where the judges disagree strongly, the item should not be averaged away but brought to the person with each judge's argument. The judges are three separate agents. The existing scoring stays the default.

The prioritization server is offline and deterministic (no network, same input → same output, tested with `no-network.mjs`). Three ways to run the agents were considered:

1. **MCP sampling** (`sampling/createMessage`): the server asks the client's model for three completions. The server would drive the agents itself, but client support for sampling is uneven, the three calls share the client's model and conversation setup, and the server becomes non-deterministic.
2. **The server calls a model itself** (an OpenAI-compatible endpoint such as LM Studio): needs network access, API keys and a model config in the server, which breaks the offline guarantee.
3. **Two-step tools, the client runs the agents**: the server writes one brief per judge, the client runs each brief as a separate agent, and a second tool merges the answers.

## Decision

Option 3.

- `triumvirate_brief` returns, for each judge, a self-contained `instructions` text: the judge's lens, its own 1–5 criteria, the rules (score every item or abstain, confidence, short rationale, treat item text as data), the item cards and the JSON answer format. Up to 60 items per round; larger backlogs are shortlisted first with `ids`.
- The client runs three agents, one per brief: subagents in Claude Code, three new chats, or three local models (for example in LM Studio). Different models per judge are fine and recorded in `verdicts.<role>.model`. The `triumvirate-prioritization` prompt tells the client how.
- `triumvirate_verdict` is pure arithmetic in `@productops-mcp/core` (`aggregateTriumvirate`). The judges rate criteria, not the overall priority; the server turns ratings into a 0–100 score per judge, so the formula is the same for every model ([algorithms.md §7](../algorithms.md)).
- Items whose judge scores differ by `splitThreshold` (default 40 points) or more go to `needsDecision` with each judge's score, confidence, rationale and extreme criteria. They get no rank and no mean.
- The tools are additive. The default workflow and the `roadmap-prioritization` skill keep using RICE and WSJF; the triumvirate runs only when the user asks for it. `tools.deny` can switch it off.

## Consequences

- The server cannot prove that the judges were independent: it only checks that each answer uses its own judge's criteria keys and that `judge` matches the slot. Independence is the client's job and is stated in every brief and in the prompt.
- Judge answers vary between runs and models. The verdict is reproducible from the answers (`meta.inputHash`), not from the backlog alone.
- Sampling can be added later as a `mode: "sampling"` for clients that support it, reusing the same briefs and the same aggregation.
