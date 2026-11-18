<!-- Example output of the roadmap-prioritization skill on the bundled demo backlog.
     Every number comes from examples/reports/demo/*.json. The eval checker validates this file in CI. -->

# Q-plan for the demo backlog (40 initiatives, RICE)

## Recommendation

Commit to the 23 initiatives that fit the base capacity. Both mandatory compliance items (INIT-014, INIT-018) are among them. The plan is driven by high-reach, low-effort work such as Home screen widgets (INIT-034, RICE 9920). The main risk is estimates: if work takes 30% longer, INIT-011, INIT-017, INIT-023, INIT-024, INIT-025 and INIT-036 drop out. INIT-024 (Customer-managed encryption keys) is ranked 3rd by WSJF.

## What we take and what we defer

Base scenario: Growth 10, Platform 12, Mobile 12 person-months. Every pool is used at 100%.

| id                                                                                                                                         | title                                  | team     | effort | how                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------- | ------ | ------------------------------- |
| INIT-034                                                                                                                                   | Home screen widgets                    | Mobile   | 1.5    | rank 1                          |
| INIT-027                                                                                                                                   | Status page and incident comms         | Platform | 1.5    | rank 2                          |
| INIT-012                                                                                                                                   | Partner marketplace listing            | Growth   | 1      | rank 3                          |
| INIT-005                                                                                                                                   | Trial expiry email sequence            | Growth   | 0.5    | rank 4                          |
| INIT-024                                                                                                                                   | Customer-managed encryption keys       | Platform | 0.5    | rank 5                          |
| INIT-009                                                                                                                                   | Win-back campaign for churned accounts | Growth   | 1      | rank 6                          |
| INIT-031, INIT-037, INIT-023, INIT-008, INIT-017, INIT-035, INIT-029, INIT-025, INIT-006, INIT-033, INIT-036, INIT-003, INIT-013, INIT-011 | the rest, in rank order                | mixed    |        | by rank                         |
| INIT-016                                                                                                                                   | Public REST API v2                     | Platform | 1.5    | dependency of INIT-012          |
| INIT-014                                                                                                                                   | SSO with SAML for enterprise           | Platform | 5.5    | mandatory                       |
| INIT-018                                                                                                                                   | Data residency in EU region            | Platform | 0.5    | mandatory                       |
| INIT-022                                                                                                                                   | Rate limiting for public API           | Platform |        | **deferred**, capacity (rank 7) |

Scenarios:

- **20% fewer people:** removes INIT-011, INIT-017, INIT-023, INIT-025 and INIT-036, and adds INIT-002 and INIT-032. Smaller items fit into the leftover capacity, because the fit is greedy, not optimal.
- **Estimates 30% low:** removes the same items plus INIT-024, and adds INIT-002.

## Trade-offs

- **INIT-014 (SSO, mandatory)** costs 5.5 of Platform's 12 person-months. Its RICE rank is 23, and effort makes up 0.8187 of its distance from a typical item. Its effort would have to drop to 5.238 for it to pass INIT-036 on merit.
- **INIT-013 (Account health score)** is a near tie at RICE rank 27, but WSJF ranks it 1st. A reach of 225.0001 instead of 200 would move it past INIT-019.
- **INIT-034** stays on top unless its reach falls to 7749.9999 or its effort grows to 1.8001.
- **Low confidence:** INIT-011, INIT-002 and INIT-040 have confidence below 50%, so treat their positions as rough.

## Method disagreements

RICE and WSJF agree only weakly: Kendall tau 0.3308, and half of their top 10 overlap. All five of RICE's top-10 items that WSJF also has in its top 10 are in the plan: INIT-027, INIT-005, INIT-024, INIT-037, INIT-023. The strongest disagreements:

- **INIT-013:** RICE 27, WSJF 1. Low reach, but high time criticality and a small job size.
- **INIT-002:** RICE 33, WSJF 10. Low impact and confidence, but high risk reduction.
- **INIT-009:** RICE 6, WSJF 24. High impact, but low business value in WSJF terms.

## Assumptions and limitations

- Capacity is in person-months and matches the `effort` unit.
- The fit is greedy by RICE rank, with mandatory items first and dependencies pulled in with the item that needs them.
- Warning: LOW_CONFIDENCE for INIT-011, INIT-002 and INIT-040.
- The data is the synthetic demo set, not real estimates.

## Reproducibility

| tool                | meta.inputHash                                                          |
| ------------------- | ----------------------------------------------------------------------- |
| calculate_rice      | sha256:726bb3ea3520dfee506f97b7135872c139b73eb23a6f65f867d5d092071dd1b4 |
| compare_initiatives | sha256:6b154c71b20b3eb82e9e367f5af9945dcb472cda5b394198298af11af0e2a289 |
| simulate_capacity   | sha256:2d2ff8c857d34436b0a59bc4f56097c64c6cb233ecbfa55ab98429dab2c4f09c |
| explain_ranking     | sha256:81c3c500a7066924452cfda46f7925a4a151d54084c61c49640c2caa6885d324 |
