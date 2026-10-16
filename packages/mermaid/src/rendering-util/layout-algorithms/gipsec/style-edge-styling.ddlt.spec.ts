import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applySyntheticContentSizes } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

describe('stress-and-grid DDLT — STYLE edge styling', () => {
  it('gives the styled converging edges separate Validate ports and label corridors', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/STYLE edge styling.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applySyntheticContentSizes(layout);
    for (const edge of layout.edges) {
      const label = (edge.label ?? edge.text ?? '').trim();
      if (label) {
        edge.width = Math.max(40, label.length * 8);
        edge.height = 24;
      }
    }

    runStressAndGridLayoutCore(layout);

    const validation = validateLayout(layout);
    const relevantIssues = validation.issues.filter(
      (issue) =>
        issue.type === 'edge-label-overlaps-foreign-edge' ||
        issue.type === 'edge-same-port-departure' ||
        issue.type === 'edge-shared-attachment-point' ||
        issue.type === 'edge-shared-subpath'
    );

    expect(relevantIssues).toEqual([]);
    expect(validation.breakdown.crossings).toBe(0);
  });
});
