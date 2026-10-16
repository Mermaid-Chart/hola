import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/SUBGRAPH linear complexity.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`compact nested linear workflow: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'stress-and-grid', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(10);
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
        )
      );
      const result = await page.evaluate(() => {
        const capture = window as unknown as {
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: { type: string }[];
            breakdown: { crossings: number; totalBendPenalty: number; edges: { points: number }[] };
          };
        };
        return capture.mermaidValidateLastLayout();
      });
      expect(
        result.issues.filter(
          (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
        )
      ).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBeLessThanOrEqual(40);
      expect(result.breakdown.edges.every((edge) => edge.points <= 4)).toBe(true);
      await page
        .locator('svg')
        .screenshot({ path: testInfo.outputPath('nested-linear-workflow.png') });
    });
  }
}

function structuralWorkflow(
  branchCount: number,
  captions = false,
  wrapper = false,
  wideCaption = false,
  unwrapped = false
): string {
  const additionalBranches = Array.from(
    { length: branchCount - 2 },
    (_, index) => `extraBranch${index}`
  );
  let variant = code.replace(
    '        hideConsole\n',
    `        hideConsole\n${additionalBranches
      .map((id, index) => `        ${id}[Additional console action ${index + 1}]`)
      .join('\n')}\n`
  );
  for (const id of additionalBranches) {
    variant += `\n    handlePointerTap --> ${id}\n    ${id} --> consoleManager`;
  }
  if (captions) {
    const branchIds = ['showConsole', 'hideConsole', ...additionalBranches];
    for (const [index, id] of branchIds.entries()) {
      variant = variant.replace(
        `handlePointerTap --> ${id}`,
        `handlePointerTap -->|Request ${index + 1}<br/>from the event queue| ${id}`
      );
      variant = variant.replace(
        `${id} --> consoleManager`,
        `${id} -->|Result ${index + 1}<br/>returned to the manager| consoleManager`
      );
    }
    variant = variant.replace(
      'updateKnob --> renderPreset',
      'updateKnob -->|Render the selected preset<br/>after the update completes| renderPreset'
    );
  }
  if (wideCaption) {
    const caption =
      'A deliberately much wider caption describes how this additional console action forwards the selected event and waits for the downstream manager to finish processing';
    variant = variant.replace(
      'handlePointerTap --> extraBranch1',
      `handlePointerTap -->|${unwrapped ? '"`' + caption + '`"' : caption}| extraBranch1`
    );
  }
  if (wrapper) {
    variant = variant.replace('flowchart TD\n', 'flowchart TD\n    subgraph Envelope\n');
    variant += `\n      subgraph Independent_sibling
        Independent[Independent sibling note]
      end
      Outer_note[Unconnected outer note]
    end`;
  }
  return variant;
}

const structuralVariants = [
  {
    name: 'three private branches',
    branches: 3,
    captions: false,
    wrapper: false,
    wideCaption: false,
    unwrapped: false,
  },
  {
    name: 'four private branches',
    branches: 4,
    captions: false,
    wrapper: false,
    wideCaption: false,
    unwrapped: false,
  },
  {
    name: 'multiline fork merge and tail captions',
    branches: 3,
    captions: true,
    wrapper: false,
    wideCaption: false,
    unwrapped: false,
  },
  {
    name: 'an enclosing frame and unrelated siblings',
    branches: 3,
    captions: false,
    wrapper: true,
    wideCaption: false,
    unwrapped: false,
  },
  {
    name: 'a long naturally wrapped caption on one of four branches',
    branches: 4,
    captions: false,
    wrapper: false,
    wideCaption: true,
    unwrapped: false,
  },
  {
    name: 'a wide single-line caption on one of four branches',
    branches: 4,
    captions: false,
    wrapper: false,
    wideCaption: true,
    unwrapped: true,
  },
] as const;

for (const variant of structuralVariants) {
  for (const look of ['classic', 'neo', 'handDrawn'] as const) {
    for (const theme of ['default', 'redux-color'] as const) {
      test(`local nested workflow with ${variant.name}: ${look}, ${theme}`, async ({
        page,
      }, testInfo) => {
        await page.addInitScript(() => {
          (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
            true;
        });
        await page.goto(
          mermaidUrl(
            structuralWorkflow(
              variant.branches,
              variant.captions,
              variant.wrapper,
              variant.wideCaption,
              variant.unwrapped
            ),
            {
              layout: 'stress-and-grid',
              look,
              theme,
              markdownAutoWrap: variant.unwrapped ? false : undefined,
            },
            false
          )
        );
        await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(
          8 + variant.branches + (variant.wrapper ? 2 : 0)
        );
        await page.waitForFunction(() =>
          Boolean(
            (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
          )
        );
        const { layout, validation } = await page.evaluate(() => {
          const capture = window as unknown as {
            mermaidLastLayoutCapture: { layout: LayoutData };
            mermaidValidateLastLayout: () => {
              ok: boolean;
              issues: { type: string }[];
              breakdown: { crossings: number; totalBendPenalty: number };
            };
          };
          return {
            layout: capture.mermaidLastLayoutCapture.layout,
            validation: capture.mermaidValidateLastLayout(),
          };
        });
        expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
        expect(
          validation.issues.filter(
            (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
          )
        ).toEqual([]);
        expect(validation.breakdown.crossings).toBe(0);
        const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
        const source = node('handlePointerTap');
        const merge = node('consoleManager');
        const branches = layout.edges
          .filter((edge) => edge.start === source.id)
          .map((edge) => node(edge.end!));
        expect(branches).toHaveLength(variant.branches);
        expect(merge.x).toBeCloseTo(source.x!, 6);
        for (const branch of branches) {
          expect(branch.y).toBeCloseTo(branches[0].y!, 6);
          expect(branch.parentId).toBe('mixerHandler');
        }
        const left = Math.min(...branches.map((branch) => branch.x! - branch.width! / 2));
        const right = Math.max(...branches.map((branch) => branch.x! + branch.width! / 2));
        expect((left + right) / 2).toBeCloseTo(source.x!, 6);
        if (variant.unwrapped) {
          // Real measured captions create unequal physical column bands; their
          // order can follow the solved geometry without fixing a semantic side.
          const caption = layout.edges.find(
            (edge) => edge.start === source.id && edge.end === 'extraBranch1'
          )!;
          expect(caption.width, 'naturally measured single-line caption').toBeGreaterThan(1000);
          const positions = branches.map((branch) => branch.x!).sort((a, b) => a - b);
          const gaps = positions.slice(1).map((position, index) => position - positions[index]);
          expect(Math.max(...gaps), 'unequal measured branch bands').toBeGreaterThan(
            2 * Math.min(...gaps)
          );
        }
        for (const edge of layout.edges) {
          expect(edge.points, edge.id).toBeDefined();
          expect(edge.points!.length, edge.id).toBeLessThanOrEqual(4);
          expect(
            edge.startSide,
            `${edge.id}: no inferred semantic departure constraint`
          ).toBeUndefined();
          expect(
            edge.endSide,
            `${edge.id}: no inferred semantic arrival constraint`
          ).toBeUndefined();
        }
        if (variant.wrapper) {
          for (const id of ['mixerHandler', 'Deck', 'Store', 'consoleManager', 'renderPreset']) {
            expect(node(id).parentId).toBe('Envelope');
          }
          expect(node('Independent').parentId).toBe('Independent_sibling');
          expect(node('Independent_sibling').parentId).toBe('Envelope');
          expect(node('Outer_note').parentId).toBe('Envelope');
        }
        await page
          .locator('svg')
          .screenshot({ path: testInfo.outputPath('nested-linear-workflow-variant.png') });
      });
    }
  }
}

type NestingVariant = {
  name: string;
  chainLengths: readonly [number, number, number, number];
  wrapperDepths: readonly [number, number, number];
  orphans: boolean;
  wideItemCaption?: boolean;
  tallStoreNote?: boolean;
};

function nestedShellWorkflow(variant: NestingVariant) {
  const lines = ['flowchart TD'];
  const parents = new Map<string, string | undefined>();
  const leaves: string[] = [];
  const chainNames = ['entry', 'item', 'key', 'update'];
  const chainStarts = ['Knob', 'ConsoleItem', 'presetKey', 'updateKnob'];
  const chains = variant.chainLengths.map((length, index) =>
    Array.from({ length }, (_, step) =>
      step === 0 ? chainStarts[index] : `${chainNames[index]}Step${step}`
    )
  );
  const leaf = (id: string, parent: string | undefined, label = id) => {
    lines.push(`    ${id}[${label}]`);
    parents.set(id, parent);
    leaves.push(id);
  };
  const frame = (id: string, parent: string | undefined, content: () => void) => {
    lines.push(`    subgraph ${id}`);
    parents.set(id, parent);
    content();
    lines.push('    end');
  };
  const wrappers = (
    prefix: string,
    depth: number,
    parent: string,
    content: (parent: string) => void,
    level = 1
  ) => {
    if (level > depth) {
      content(parent);
      return;
    }
    const id = `${prefix}Layer${level}`;
    frame(id, parent, () => wrappers(prefix, depth, id, content, level + 1));
  };
  const addChain = (chain: string[], parent: string) => {
    for (const id of chain) {
      leaf(id, parent);
    }
  };
  const orphan = (parent: string) => {
    if (variant.orphans) {
      const label =
        variant.tallStoreNote && parent === 'Store'
          ? Array.from({ length: 40 }, (_, index) => `Store note line ${index + 1}`).join('<br/>')
          : `Independent note in ${parent}`;
      leaf(`${parent}Note`, parent, label);
    }
  };
  frame('Deck', undefined, () => {
    addChain(chains[0], 'Deck');
    orphan('Deck');
    wrappers('Console', variant.wrapperDepths[0], 'Deck', (parent) => {
      frame('Console', parent, () => {
        addChain(chains[1], 'Console');
        orphan('Console');
        wrappers('PresetRack', variant.wrapperDepths[1], 'Console', (innerParent) => {
          frame('PresetRack', innerParent, () => {
            addChain(chains[2], 'PresetRack');
            orphan('PresetRack');
          });
        });
      });
    });
  });
  frame('Store', undefined, () => {
    leaf('mixerState', 'Store');
    orphan('Store');
    wrappers('Update', variant.wrapperDepths[2], 'Store', (parent) => {
      frame('busRoutingCueState', parent, () => {
        addChain(chains[3], 'busRoutingCueState');
        orphan('busRoutingCueState');
      });
    });
  });
  frame('mixerHandler', undefined, () => {
    for (const id of ['handlePointerTap', 'showConsole', 'hideConsole']) {
      leaf(id, 'mixerHandler');
    }
  });
  leaf('consoleManager', undefined);
  leaf('renderPreset', undefined);
  for (const [index, chain] of chains.entries()) {
    for (let step = 0; step < chain.length - 1; step++) {
      lines.push(
        `    ${chain[step]} -->|Private ${chainNames[index]} stage ${step + 1}<br/>before the next operation| ${chain[step + 1]}`
      );
    }
  }
  lines.push(
    `    ${chains[0].at(-1)} -- OnClick --> handlePointerTap`,
    '    handlePointerTap --> showConsole',
    '    handlePointerTap --> hideConsole',
    '    showConsole --> consoleManager',
    '    hideConsole --> consoleManager',
    '    consoleManager -. Opens instance .-> Console',
    variant.wideItemCaption
      ? `    ${chains[1].at(-1)} -->|"\`A wide measured item caption describes opening the selected nested preset frame\`"| PresetRack`
      : `    ${chains[1].at(-1)} -- OnClick --> PresetRack`,
    '    PresetRack -. Update .- mixerState',
    `    ${chains[2].at(-1)} -- onSelection --> ${chains[3][0]}`,
    `    ${chains[3].at(-1)} --> renderPreset`
  );
  return { code: lines.join('\n'), parents, leaves, chains };
}

const nestingVariants: readonly NestingVariant[] = [
  {
    name: 'private chains of two and three measured-caption stages',
    chainLengths: [2, 3, 2, 3],
    wrapperDepths: [0, 0, 0],
    orphans: false,
  },
  {
    name: 'unary frame paths of one and three wrappers',
    chainLengths: [1, 1, 1, 1],
    wrapperDepths: [1, 3, 1],
    orphans: false,
  },
  {
    name: 'independent orphan leaves in selected frames',
    chainLengths: [1, 1, 1, 1],
    wrapperDepths: [0, 0, 0],
    orphans: true,
  },
  {
    name: 'private chains wrappers and independent selected-frame leaves together',
    chainLengths: [3, 2, 3, 2],
    wrapperDepths: [3, 1, 3],
    orphans: true,
  },
  {
    name: 'an unwrapped measured wide item to frame caption',
    chainLengths: [1, 1, 1, 1],
    wrapperDepths: [0, 0, 0],
    orphans: false,
    wideItemCaption: true,
  },
  {
    name: 'a forty-line Store orphan beside the measured workflow',
    chainLengths: [1, 1, 1, 1],
    wrapperDepths: [0, 0, 0],
    orphans: true,
    tallStoreNote: true,
  },
];

for (const variant of nestingVariants) {
  for (const look of ['classic', 'neo', 'handDrawn'] as const) {
    for (const theme of ['default', 'redux-color'] as const) {
      test(`variable nested shell with ${variant.name}: ${look}, ${theme}`, async ({
        page,
      }, testInfo) => {
        const input = nestedShellWorkflow(variant);
        await page.addInitScript(() => {
          (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
            true;
        });
        await page.goto(
          mermaidUrl(
            input.code,
            {
              layout: 'stress-and-grid',
              look,
              theme,
              markdownAutoWrap: variant.wideItemCaption ? false : undefined,
            },
            false
          )
        );
        await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(input.leaves.length);
        await page.waitForFunction(() =>
          Boolean(
            (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
          )
        );
        const { layout, validation } = await page.evaluate(() => {
          const capture = window as unknown as {
            mermaidLastLayoutCapture: { layout: LayoutData };
            mermaidValidateLastLayout: () => {
              ok: boolean;
              issues: { type: string }[];
              breakdown: { crossings: number };
            };
          };
          return {
            layout: capture.mermaidLastLayoutCapture.layout,
            validation: capture.mermaidValidateLastLayout(),
          };
        });
        expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
        expect(
          validation.issues.filter(
            (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
          )
        ).toEqual([]);
        expect(validation.breakdown.crossings).toBe(0);
        const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
        if (variant.wideItemCaption) {
          const caption = layout.edges.find(
            (edge) => edge.start === 'ConsoleItem' && edge.end === 'PresetRack'
          )!;
          expect(caption.width, 'native unwrapped item-to-frame caption').toBeGreaterThanOrEqual(
            300
          );
        }
        if (variant.tallStoreNote) {
          const note = node('StoreNote');
          expect(String(note.label).match(/Store note line \d+/g)).toHaveLength(40);
          expect(note.height, 'oversized native orphan across theme font metrics').toBeGreaterThan(
            10 * node('mixerState').height!
          );
        }
        for (const [id, parent] of input.parents) {
          const child = node(id);
          expect(child.parentId, `${id}: original semantic parent`).toBe(parent);
          if (parent) {
            const ancestor = node(parent);
            expect(child.x! - child.width! / 2, `${id}: left containment`).toBeGreaterThanOrEqual(
              ancestor.x! - ancestor.width! / 2
            );
            expect(child.x! + child.width! / 2, `${id}: right containment`).toBeLessThanOrEqual(
              ancestor.x! + ancestor.width! / 2
            );
            expect(child.y! - child.height! / 2, `${id}: top containment`).toBeGreaterThanOrEqual(
              ancestor.y! - ancestor.height! / 2
            );
            expect(child.y! + child.height! / 2, `${id}: bottom containment`).toBeLessThanOrEqual(
              ancestor.y! + ancestor.height! / 2
            );
          }
        }
        for (const chain of input.chains) {
          for (let step = 0; step < chain.length - 1; step++) {
            const edge = layout.edges.find(
              (candidate) => candidate.start === chain[step] && candidate.end === chain[step + 1]
            )!;
            expect(edge.points, `${edge.id}: measured-caption private chain`).toHaveLength(2);
          }
        }
        const source = node('handlePointerTap');
        const merge = node('consoleManager');
        expect(merge.x).toBeCloseTo(source.x!, 6);
        const branches = [node('showConsole'), node('hideConsole')];
        expect(branches[0].y).toBeCloseTo(branches[1].y!, 6);
        const left = Math.min(...branches.map((branch) => branch.x! - branch.width! / 2));
        const right = Math.max(...branches.map((branch) => branch.x! + branch.width! / 2));
        expect((left + right) / 2).toBeCloseTo(source.x!, 6);
        for (const edge of layout.edges) {
          expect(edge.points, edge.id).toBeDefined();
          expect(edge.points!.length, edge.id).toBeLessThanOrEqual(4);
          expect(edge.startSide, `${edge.id}: semantic departure unchanged`).toBeUndefined();
          expect(edge.endSide, `${edge.id}: semantic arrival unchanged`).toBeUndefined();
        }
        await page
          .locator('svg')
          .screenshot({ path: testInfo.outputPath('nested-linear-workflow-variable-shell.png') });
      });
    }
  }
}
