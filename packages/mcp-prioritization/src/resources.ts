/** Method reference texts served as MCP resources, so models cite these instead of memory. */
export const METHOD_RESOURCES = {
  rice: {
    uri: 'productops://methods/rice',
    title: 'RICE scoring method',
    text: `# RICE

score = (reach × impact × confidence) / effort

| Field | Meaning | Scale |
| --- | --- | --- |
| reach | people or events affected per period (e.g. per quarter) | ≥ 0 |
| impact | effect per person | 0.25 minimal, 0.5 low, 1 medium, 2 high, 3 massive |
| confidence | how sure we are about reach, impact and effort | 0..1 (0.5 = 50%) |
| effort | work needed, person-months by default | > 0 |

Ranking: higher score first; ties break by lower effort, then by id.
Confidence below 0.5 is flagged LOW_CONFIDENCE: treat such scores as rough.
Scores are comparable only inside one dataset with the same reach period and effort unit.
`,
  },
  wsjf: {
    uri: 'productops://methods/wsjf',
    title: 'WSJF scoring method',
    text: `# WSJF (Weighted Shortest Job First, SAFe)

cost of delay = business value + time criticality + risk reduction / opportunity enablement
score = cost of delay / job size

All four inputs use the modified Fibonacci scale 1, 2, 3, 5, 8, 13, 20 and are relative:
the smallest item in the set is the reference. Option normalize rescales each component so
its smallest value in the set is 1.

Ranking: higher score first; ties break by smaller job size, then by id.
FIB_SCALE_SATURATED warns when more than half of the items share one value of a component.
`,
  },
} as const;
