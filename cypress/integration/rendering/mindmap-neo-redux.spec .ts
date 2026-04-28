import { imgSnapshotTest } from '../../helpers/util';

/**
 * Check whether the SVG Element has a Mindmap root
 * Ensures the mindmap structure is generated correctly before taking a snapshot.
 */
function shouldHaveRoot($p: JQuery<SVGSVGElement>) {
  const svgElement = $p[0];
  expect(svgElement.nodeName).equal('svg');
  const sectionRoots = svgElement.getElementsByClassName('mindmap-node section-root');
  expect(sectionRoots).to.have.lengthOf.at.least(1);
}

const lightThemes = ['neo', 'redux', 'redux-color'] as const;
const darkThemes = ['neo-dark', 'redux-dark', 'redux-dark-color'] as const;

lightThemes.forEach((theme) => {
  describe(`Mindmaps (Neo Look) - ${theme}`, () => {
    it('Basic root node', () => {
      imgSnapshotTest(`mindmap\nroot`, { theme, look: 'neo' }, undefined, shouldHaveRoot);
    });

    it('Root with child nodes', () => {
      imgSnapshotTest(
        `mindmap\nroot\n  child1\n  child2\n    grandchild1\n    grandchild2`,
        { theme, look: 'neo' },
        undefined,
        shouldHaveRoot
      );
    });

    it('Root with different shapes', () => {
      imgSnapshotTest(
        `mindmap\nroot[Square]\n  child1((Circle))\n  child2(Round rectangle)\n  child3[A different square]`,
        { theme, look: 'neo' },
        undefined,
        shouldHaveRoot
      );
    });

    it('Nodes with long wrapping text', () => {
      imgSnapshotTest(
        // eslint-disable-next-line @cspell/spellchecker
        `mindmap\nroot[A very long root node text that should wrap properly]\n  child1[A long child node text to check wrapping behavior]\n  child2[A veryveryverylongwordthatshouldwrapproperlywithoutoverflowing]`,
        { theme, look: 'neo' },
        undefined,
        shouldHaveRoot
      );
    });

    it('Mindmap with icons', () => {
      const icon = ' ::icon(fa fa-bell)';
      imgSnapshotTest(
        `mindmap
        root((I am a cloud))
          Origins
            Long history
            ${icon}`,
        { theme, look: 'neo' },
        undefined,
        shouldHaveRoot
      );
    });

    it('Mindmap with Markdown formatting', () => {
      imgSnapshotTest(
        `mindmap
    id1["**Start** with
    a second line 😎"]
      id2["The dog in **the** hog... a *very long text* about it Word!"]`,
        { theme, look: 'neo', darkMode: true },
        undefined,
        shouldHaveRoot
      );
    });
  });
});

darkThemes.forEach((theme) => {
  describe(`Mindmaps (Neo Look - Dark Mode) - ${theme}`, () => {
    it('Basic root node', () => {
      imgSnapshotTest(
        `mindmap\nroot`,
        { theme, look: 'neo', darkMode: true },
        undefined,
        shouldHaveRoot
      );
    });

    it('Root with child nodes', () => {
      imgSnapshotTest(
        `mindmap\nroot\n  child1\n  child2\n    grandchild1\n    grandchild2`,
        { theme, look: 'neo', darkMode: true },
        undefined,
        shouldHaveRoot
      );
    });

    it('Root with different shapes', () => {
      imgSnapshotTest(
        `      %%{
        init: {
          'themeVariables': {
            'fill': '#000000'
          }
        }
      }%%\nmindmap\nroot[Square]\n  child1((Circle))\n  child2(Round rectangle)\n  child3[A different square]`,
        { theme, look: 'neo', darkMode: true },
        undefined,
        shouldHaveRoot
      );
    });

    it('Nodes with long wrapping text', () => {
      imgSnapshotTest(
        // eslint-disable-next-line @cspell/spellchecker
        `mindmap\nroot[A very long root node text that should wrap properly]\n  child1[A long child node text to check wrapping behavior]\n  child2[A veryveryverylongwordthatshouldwrapproperlywithoutoverflowing]`,
        { theme, look: 'neo', darkMode: true },
        undefined,
        shouldHaveRoot
      );
    });

    it('Mindmap with icons', () => {
      const icon = ' ::icon(fa fa-bell)';
      imgSnapshotTest(
        `mindmap
        root((I am a cloud))
          Origins
            Long history
            ${icon}`,
        { theme, look: 'neo', darkMode: true },
        undefined,
        shouldHaveRoot
      );
    });

    it('Mindmap with Markdown formatting', () => {
      imgSnapshotTest(
        `mindmap\nroot[\`**Bold** and *Italic* text\`]\n  child1[\`Line1\\nLine2 with a break\`]\n  child2[\`An emoji 😎 inside\`]`,
        { theme, look: 'neo', darkMode: true, themeVariables: {} },
        undefined,
        shouldHaveRoot
      );
    });
  });
});
