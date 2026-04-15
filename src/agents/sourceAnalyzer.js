import path from 'node:path';
import { AGENT_NAME, ISSUE_CATEGORY, ISSUE_SEVERITY } from '../utils/constants.js';
import { assertReadableFile, readFileMetadata } from '../utils/fileUtils.js';
import { buildMockSections, getScenarioHints } from '../utils/docxSimulation.js';

const titleFromName = (filePath) => {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
};

export const sourceAnalyzer = async (state) => {
  const submittedPath = state.files.submittedPath;
  await assertReadableFile(submittedPath, 'Submitted');

  const metadata = await readFileMetadata(submittedPath);
  const hints = getScenarioHints(state.files);
  const issues = [];
  const tables = hints.sourceHasTables
    ? [{ id: 'table-1', caption: 'Ablation results', desiredCaptionPosition: 'above' }]
    : [];
  const figures = hints.sourceHasFigures
    ? (hints.sourceMultiFigure
      ? [{ id: 'figure-1', caption: 'System overview' }, { id: 'figure-2', caption: 'Repair loop example' }]
      : [{ id: 'figure-1', caption: 'System overview' }])
    : [];
  const lists = hints.sourceHasLists
    ? [{ id: 'list-1', style: 'bullet', items: ['Item 1', 'Item 2', 'Item 3'] }]
    : [];

  if (metadata.extension !== '.docx') {
    issues.push({
      category: ISSUE_CATEGORY.INVALID_INPUT,
      severity: ISSUE_SEVERITY.CRITICAL,
      message: 'Submitted file must use .docx extension.',
    });
  }

  if (hints.sourceIsAmbiguous || hints.sourceSemanticGap) {
    issues.push({
      category: ISSUE_CATEGORY.AMBIGUOUS_CONTENT,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Semantic structure extraction is ambiguous and may need another analysis pass.',
    });
  }

  const contentMap = {
    title: titleFromName(submittedPath),
    authors: ['Dana Lee', 'Jordan Patel'],
    affiliations: ['Prototype Systems Lab'],
    abstract: hints.sourceMissingAbstract ? '' : 'This prototype evaluates how supervisor-orchestrated agents can reformat conference papers while preserving content.',
    keywords: ['document reformatting', 'agent graph', 'workflow orchestration'],
    sections: buildMockSections(hints),
    lists,
    tables,
    figures,
    references: hints.sourceMissingReferences ? [] : ['Reference A', 'Reference B', 'Reference C'],
    frontMatter: {
      title: true,
      authors: true,
      affiliations: true,
      abstract: !hints.sourceMissingAbstract,
      keywords: true,
    },
    metadata,
  };

  const confidence = hints.sourceIsAmbiguous || hints.sourceSemanticGap ? 0.58 : 0.87;

  if (!contentMap.abstract) {
    issues.push({
      category: ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Abstract was not confidently detected in submitted document.',
    });
  }

  if (!contentMap.references.length) {
    issues.push({
      category: ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'References section is missing or incomplete in submitted content.',
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== ISSUE_SEVERITY.CRITICAL),
    agent: AGENT_NAME.SOURCE_ANALYZER,
    confidence,
    contentMap,
    issues,
    inputSummary: {
      submittedPath,
      previousRetries: state.retries.sourceAnalyzer,
    },
    outputSummary: {
      confidence,
      sectionCount: contentMap.sections.length,
      referenceCount: contentMap.references.length,
    },
  };
};
