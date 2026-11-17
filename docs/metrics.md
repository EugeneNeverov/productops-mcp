# Sprint metrics

How `productops-jira` computes every number it returns. The code is in `packages/core/src/work/`; it works on a tracker-neutral `WorkItem` model (spec §7.2), so none of it knows about Jira. Tests with hand-calculated expected values are in `packages/core/src/work/health.test.ts`.

## Time

- **Working days.** Monday–Friday time in UTC, counted as a fraction of a day. Weekend time does not count. Holidays are not modelled.
- **Evaluation time.** A closed sprint is evaluated at its completion date (or end date). An active sprint is evaluated now. In fixtures mode "now" is the dataset's frozen time, so results are reproducible.
- **Elapsed.** `elapsedPct` = working days from sprint start to the evaluation time (capped at the sprint end) ÷ working days from start to end. A closed sprint is 100%.

## Sprint scope

Every item that was ever in the sprint is read with its sprint-field history.

- **Members**: items in the sprint at the evaluation time.
- **Starting scope**: items in the sprint at the start. Changes recorded up to 30 seconds after the start still count as the starting scope, because trackers record "issues added when the sprint was started" around that moment and clocks differ (the spike measured a 16-second skew).
- **Added after start**: items that were not in the starting scope and were added later.
- **Removed after start**: items removed from the sprint after the start (also those added after the start and removed again).
- **Carried over**: members that were also in the previous closed sprint.
- **Weights.** When at least one item ever in the sprint has an estimate, weights are estimates (unestimated items weigh 0). Otherwise every item weighs 1 and the unit is `issues`.

## `get_sprint_issues`

- `counts.byCategory` uses each member's status category at the evaluation time.
- `estimate.committed` = sum of member weights; `estimate.completed` = sum for members in `done`; `unestimatedCount` = members without an estimate.

## Cycle time (`analyze_cycle_time`)

- **Cycle time** = working days from the **first** move into an `in_progress` status to the **last** move into `done`.
- Items that reached done without ever being in progress are excluded and counted in `excludedNoStart`.
- Reopened items (done, then moved back) count once, with their last done, and are counted in `reopened`.
- **Percentiles** use linear interpolation (numpy's default). A group with fewer than 5 items gets `null` percentiles and a `SMALL_SAMPLE` warning.
- **Time in status**: for each completed item, the working days spent in each status between its start and finish. `medianDays` is the median over items that visited the status; `sharePct` is that status's share of all cycle time.
- **Outliers**: items above the overall p95, at most 10, slowest first.
- **Window.** `lastSprints: N` takes the items completed in the last N closed sprints. `from`/`to` takes items whose last move to done falls in that date range (at most 180 days).

## Blockers (`find_blockers`)

Only items that are not done are considered. Signals:

| Signal                 | When                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `FLAGGED`              | the item is flagged (Jira "Flagged" / impediment)                    |
| `BLOCKED_BY_OPEN_LINK` | an "is blocked by" link points to an item that is not done           |
| `STALE_IN_PROGRESS`    | in progress with no transition for at least `staleDays` working days |
| `BLOCKED_STATUS`       | the status name is in `jira.blockedStatuses` (default `["Blocked"]`) |

`daysInCurrentStatus` is measured from the last transition (or creation). Severity:

- **high**: 2 or more signals, or an open blocking link on an item estimated at or above the sprint's median estimate;
- **medium**: 1 signal and more than `staleDays` in the current status;
- **low**: everything else.

## Sprint health (`assess_sprint_health`)

| Metric                   | Definition                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `completionPct`          | completed weight ÷ committed weight of the members                                     |
| `scopeChangePct`         | (weight added after start + weight removed after start) ÷ weight of the starting scope |
| `carryOverFromPrevious`  | number of members that were also in the previous closed sprint                         |
| `wip.current`            | members in progress                                                                    |
| `wip.perAssigneeMax`     | most in-progress items held by one assignee (unassigned items are not counted)         |
| `blockersHigh`           | blockers with severity high (`staleDays` = 3)                                          |
| `cycleTimeP85VsBaseline` | p85 cycle time of items completed in this sprint ÷ mean p85 of the baseline sprints    |
| `unestimatedPct`         | members without an estimate ÷ members                                                  |

Checks compare a value with its thresholds: `value ≥ risk` → `risk`, `value ≥ warn` → `warn`, else `ok`.

| Check                   | Value                                  | warn  | risk |
| ----------------------- | -------------------------------------- | ----- | ---- |
| `BURNDOWN_LAG`          | `elapsedPct − completionPct`           | 15    | 30   |
| `SCOPE_CREEP`           | `scopeChangePct`                       | 10    | 25   |
| `BLOCKERS`              | `blockersHigh`                         | 1     | 3    |
| `WIP_OVERLOAD`          | `wip.perAssigneeMax`                   | 3     | 5    |
| `CYCLE_TIME_REGRESSION` | `cycleTimeP85VsBaseline`               | ×1.25 | ×1.5 |
| `ESTIMATION_GAPS`       | `unestimatedPct`                       | 10    | 25   |
| `CARRY_OVER`            | carried-over items ÷ starting scope, % | 10    | 25   |

Thresholds can be changed in `productops.config.json` → `jira.health.thresholds` and are returned with every check.

- **Baseline.** The `baselineSprints` closed sprints before this one. Each needs at least 5 completed items. If any baseline sprint falls short, or there is none, `CYCLE_TIME_REGRESSION` is `ok` with value `null` and the warning `NO_BASELINE`. If this sprint has fewer than 5 completed items, the same applies with `SMALL_SAMPLE`. Without a previous sprint, `CARRY_OVER` is 0 with `NO_PREVIOUS_SPRINT`.
- **Evidence.** Up to 10 issues per check: not-done items by estimate (burndown), added and removed items (scope), high blockers, the busiest assignee's in-progress items (WIP), items slower than this sprint's p85 (cycle time), unestimated items, carried-over items.
- **Score.** `healthScore = max(0, 100 − 7 × warns − 15 × risks)`.

## Untrusted text

Summaries and sprint goals come back as `{ text, untrusted: true, truncated }` (spec §9.1). Control, zero-width and bidi characters are removed, markdown links and images are reduced to their label, whitespace is collapsed, and the text is cut at `jira.returnText.maxChars` (default 500). Text that looks like instructions to a model is kept but listed in a `SUSPICIOUS_CONTENT` warning. Descriptions and comments are never read.
