import path from 'node:path';

const tokenize = (filePath) => path.basename(filePath || '').toLowerCase();
const includesAny = (value, tokens) => tokens.some((token) => value.includes(token));

export const getScenarioHints = ({ targetPath, submittedPath }) => {
  const targetName = tokenize(targetPath);
  const submittedName = tokenize(submittedPath);
  const sourceOmitsFigures = includesAny(submittedName, ['no-figure', 'no-figures', 'without-figure', 'without-figures']);
  const sourceOmitsTables = includesAny(submittedName, ['no-table', 'no-tables', 'without-table', 'without-tables']);
  const sourceOmitsLists = includesAny(submittedName, ['no-list', 'no-lists', 'without-list', 'without-lists']);
  const sourceHasFigures = !sourceOmitsFigures && includesAny(submittedName, ['figure', 'figures', 'qa-fail']);
  const sourceHasTables = !sourceOmitsTables && includesAny(submittedName, ['table', 'tables', 'qa-fail']);
  const sourceHasLists = !sourceOmitsLists && includesAny(submittedName, ['list', 'lists']);

  return {
    targetIsStrict: targetName.includes('strict') || targetName.includes('camera-ready'),
    targetIsAmbiguous: targetName.includes('ambiguous'),
    sourceIsAmbiguous: submittedName.includes('ambiguous'),
    sourceMissingAbstract: submittedName.includes('missing-abstract'),
    sourceMissingReferences: submittedName.includes('missing-references'),
    sourceSemanticGap: submittedName.includes('semantic-gap'),
    sourceQaFailure: submittedName.includes('qa-fail'),
    sourceEscalate: submittedName.includes('escalate'),
    sourceSparse: submittedName.includes('sparse'),
    sourceHasTables,
    sourceHasFigures,
    sourceHasLists,
    sourceMultiFigure: sourceHasFigures && includesAny(submittedName, ['figures', 'multi-figure', 'multi-figures']),
  };
};

export const deriveConferenceFlavor = (targetPath) => {
  const name = tokenize(targetPath);
  if (name.includes('ieee')) return 'ieee';
  if (name.includes('acm')) return 'acm';
  if (name.includes('neurips')) return 'neurips';
  return 'generic_conference';
};

export const buildMockSections = (hints) => {
  const sections = [
    { id: 'intro', title: 'Introduction', level: 1, blocks: 4 },
    { id: 'method', title: 'Method', level: 1, blocks: 5 },
    { id: 'results', title: 'Results', level: 1, blocks: 3 },
    { id: 'conclusion', title: 'Conclusion', level: 1, blocks: 2 },
  ];

  if (hints.sourceSparse) {
    return sections.slice(0, 2);
  }

  if (hints.sourceSemanticGap) {
    return sections.map((section) => ({ ...section, confidence: 0.5 }));
  }

  return sections;
};
