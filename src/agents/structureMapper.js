import { AGENT_NAME, FRONT_MATTER_ORDER, ISSUE_CATEGORY, ISSUE_SEVERITY } from '../utils/constants.js';
import { getScenarioHints } from '../utils/docxSimulation.js';
import { runStructureMapperAgent } from '../services/openaiAgents.js';

export const structureMapper = async (state) => {
  const templateProfile = state.artifacts.templateProfile;
  const contentMap = state.artifacts.contentMap;
  const issues = [];
  const hints = getScenarioHints(state.files);

  if (!templateProfile || !contentMap) {
    return {
      ok: false,
      agent: AGENT_NAME.STRUCTURE_MAPPER,
      confidence: 0,
      transformationPlan: null,
      issues: [{
        category: ISSUE_CATEGORY.MISSING_ARTIFACT,
        severity: ISSUE_SEVERITY.CRITICAL,
        message: 'Template profile and content map must exist before mapping.',
      }],
      inputSummary: {},
      outputSummary: {},
    };
  }

  let transformationPlan = {
    sectionOrder: [...FRONT_MATTER_ORDER, 'body', 'references'],
    headingPolicy: {
      numberingDepth: templateProfile.styleSignals.headingNumberDepth,
      styleNames: ['Heading1', 'Heading2'],
      lowerLevels: 'run_in',
    },
    captionPolicy: {
      tables: templateProfile.styleSignals.tableCaptionPosition,
      figures: templateProfile.styleSignals.figureCaptionPosition,
    },
    referencePolicy: {
      location: 'end',
      style: templateProfile.styleInventory.referenceStyle,
      numbering: 'sequential',
    },
    frontMatterPolicy: {
      order: FRONT_MATTER_ORDER,
      abstractBeforeKeywords: templateProfile.styleSignals.abstractBeforeKeywords,
      titleStyle: templateProfile.styleInventory.titleStyle,
      authorStyle: templateProfile.styleInventory.authorStyle,
    },
    structureRequirements: templateProfile.structureRequirements,
    blockPlan: [
      ...FRONT_MATTER_ORDER,
      ...contentMap.sections.map((section) => section.id),
      'references',
    ],
    repairHistory: [],
  };

  if (!contentMap.abstract) {
    issues.push({
      category: ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Transformation plan is missing abstract placement because abstract content is absent.',
      routeTo: 'sourceAnalyzer',
    });
  }

  if (!contentMap.references.length) {
    issues.push({
      category: ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Transformation plan cannot finalize reference formatting without references.',
      routeTo: 'sourceAnalyzer',
    });
  }

  if (hints.sourceSemanticGap) {
    issues.push({
      category: ISSUE_CATEGORY.AMBIGUOUS_CONTENT,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Section-to-template mapping remains ambiguous.',
      routeTo: 'sourceAnalyzer',
    });
  }

  const confidencePenalty = issues.length * 0.12;
  let confidence = Math.max(0.45, 0.9 - confidencePenalty);

  const sdkPlan = await runStructureMapperAgent({
    templateProfile,
    contentMap,
    baselinePlan: transformationPlan,
    issues,
  });

  if (sdkPlan) {
    transformationPlan = {
      ...sdkPlan,
      repairHistory: sdkPlan.repairHistory || [],
      planner: 'openai_agents_sdk',
    };
    confidence = Math.max(confidence, 0.93);
  }

  return {
    ok: issues.length === 0,
    agent: AGENT_NAME.STRUCTURE_MAPPER,
    confidence,
    transformationPlan,
    issues,
    inputSummary: {
      templateFlavor: templateProfile.conferenceFlavor,
      sectionCount: contentMap.sections.length,
    },
    outputSummary: {
      confidence,
      plannedBlockCount: transformationPlan.blockPlan.length,
    },
  };
};
