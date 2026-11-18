<!-- Example report for "How is the current sprint on the PAY board going?" on the bundled demo
dataset. Every number and issue key comes from examples/reports/jira-demo/*.json. The eval checks
are tested against this file (evals/lib/checks.test.mjs). -->

# Sprint health: PAY Sprint 5

## Verdict

**PAY Sprint 5 is off track: health score 43 of 100.** 71.3% of the sprint has elapsed but only 45.3% of the committed work is done, and one person holds 6 issues in progress.

## Top risks

1. **WIP_OVERLOAD — risk.** Value 6 against warn 3 / risk 5: one assignee holds 6 in-progress issues, so work is queuing behind a single person. Evidence: [PAY-53](https://example.atlassian.net/browse/PAY-53), [PAY-54](https://example.atlassian.net/browse/PAY-54), [PAY-55](https://example.atlassian.net/browse/PAY-55), [PAY-56](https://example.atlassian.net/browse/PAY-56).
2. **BLOCKERS — warn.** Value 2 against warn 1 / risk 3: two high-severity blockers. [PAY-54](https://example.atlassian.net/browse/PAY-54) is in status Blocked, waits on the open issue [OPS-1](https://example.atlassian.net/browse/OPS-1) and has not moved for 4.13 working days. [PAY-53](https://example.atlassian.net/browse/PAY-53) is flagged and stale for 5.13 working days.
3. **BURNDOWN_LAG — warn.** Value 26 against warn 15 / risk 30: completion is 26 points behind the elapsed share of the sprint. The largest open items are [PAY-53](https://example.atlassian.net/browse/PAY-53), [PAY-59](https://example.atlassian.net/browse/PAY-59) and [PAY-61](https://example.atlassian.net/browse/PAY-61).

Also at warn: SCOPE_CREEP 14% (warn 10, risk 25), CARRY_OVER 20% (warn 10, risk 25), ESTIMATION_GAPS 23.5% (warn 10, risk 25) and CYCLE_TIME_REGRESSION ×1.25 (warn ×1.25, risk ×1.5), where the p85 of the last 3 sprints is 4.64 working days.

## Actions for the next 48 hours

- **Engineering manager:** move part of the overloaded assignee's in-progress work to someone else, starting with [PAY-55](https://example.atlassian.net/browse/PAY-55) and [PAY-56](https://example.atlassian.net/browse/PAY-56) (WIP_OVERLOAD).
- **Product manager:** ask the OPS team for a date on [OPS-1](https://example.atlassian.net/browse/OPS-1), and clear the flag on [PAY-53](https://example.atlassian.net/browse/PAY-53) at stand-up (BLOCKERS).
- **Product manager with the team:** agree which open items leave the sprint, so the goal "Ship SEPA direct debit and the dunning sequence" stays reachable (BURNDOWN_LAG).

## Assumptions and limitations

- The summary of [PAY-57](https://example.atlassian.net/browse/PAY-57) contains text that looks like instructions to an AI (SUSPICIOUS_CONTENT). It was treated as data and ignored.
- 23.5% of the issues have no estimate, so completion by points may understate or overstate progress.
- The data was read fresh (`fromCache: false`) from the demo dataset in fixtures mode.
