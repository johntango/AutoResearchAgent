import { AGENT_NAME, ISSUE_CATEGORY, ISSUE_SEVERITY, OPTIONAL_DOCUMENT_STRUCTURES, REQUIRED_DOCUMENT_STRUCTURES } from '../utils/constants.js';
import { assertReadableFile, readFileMetadata } from '../utils/fileUtils.js';
import { deriveConferenceFlavor, getScenarioHints } from '../utils/docxSimulation.js';

export const templateProfiler = async (state) => {
  const targetPath = state.files.targetPath;
  await assertReadableFile(targetPath, 'Target');

  const metadata = await readFileMetadata(targetPath);
  const hints = getScenarioHints(state.files);
  const flavor = deriveConferenceFlavor(targetPath);
  const confidence = hints.targetIsAmbiguous ? 0.66 : 0.9;
  const issues = [];

  if (metadata.extension !== '.docx') {
    issues.push({
      category: ISSUE_CATEGORY.INVALID_INPUT,
      severity: ISSUE_SEVERITY.CRITICAL,
      message: 'Target file must use .docx extension.',
    });
  }

  if (hints.targetIsAmbiguous) {
    issues.push({
      category: ISSUE_CATEGORY.AMBIGUOUS_CONTENT,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Target template profile is partially ambiguous; using conservative default style signals.',
    });
  }

  return {
    ok: issues.every((issue) => issue.severity !== ISSUE_SEVERITY.CRITICAL),
    agent: AGENT_NAME.TEMPLATE_PROFILER,
    confidence,
    templateProfile: {
      templateName: metadata.name,
      metadata,
      conferenceFlavor: flavor,
      styleSignals: {
        headingNumberDepth: flavor === 'acm' ? 0 : 2,
        tableCaptionPosition: 'above',
        figureCaptionPosition: 'below',
        abstractBeforeKeywords: true,
        referencesAtEnd: true,
        columnLayout: hints.targetIsStrict ? 2 : 1,
        frontMatterAlignment: flavor === 'ieee' ? 'centered' : 'left',
      },
      styleInventory: {
        titleStyle: 'Title',
        authorStyle: 'Author',
        affiliationStyle: 'Affiliation',
        abstractStyle: 'Abstract',
        keywordStyle: 'Keywords',
        heading1Style: 'Heading1',
        heading2Style: 'Heading2',
        bodyStyle: 'BodyText',
        referenceStyle: 'References',
      },
      structureRequirements: {
        required: REQUIRED_DOCUMENT_STRUCTURES,
        optional: OPTIONAL_DOCUMENT_STRUCTURES,
      },
    },
    issues,
    inputSummary: {
      targetPath,
      conferenceFlavor: flavor,
    },
    outputSummary: {
      confidence,
      issueCount: issues.length,
    },
  };
};
