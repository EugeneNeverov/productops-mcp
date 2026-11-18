# Report template: roadmap-prioritization

Use these sections in this order. Translate the headings into the user's language and drop none of them. If a section has nothing to say, write one line explaining why.

## Recommendation

Three sentences at most: what to commit to, the main reason, the main risk.

## What we take and what we defer

A table from `simulate_capacity` (base scenario). Columns:

- id;
- title;
- team;
- effort;
- how it got in (`via`), or the deferral reason.

List every included item. List deferred items that rank in the top 10 of any method. Add one line per extra scenario with what it adds or removes (`diffVsFirst`).

## Trade-offs

For 3–5 items, say what would change the decision. Take this from `explain_ranking.sensitivity`, for example: "INIT-014 needs effort 5.238 instead of 5.5 to pass INIT-036". Mention `NEAR_TIE` and `LOW_CONFIDENCE` items here.

## Method disagreements

`kendallTau` and top-N overlap from `compare_initiatives`, the 2–3 strongest disagreements, and their drivers in plain words. Skip with one line if only one method was used.

## Assumptions and limitations

Every tool warning, excluded items, the capacity unit, and the fact that the fit is greedy.

## Reproducibility

Tool names and `meta.inputHash` of each result.
