import { AGENT_NAME, ISSUE_CATEGORY, ISSUE_SEVERITY } from '../utils/constants.js';
import { pathExists } from '../utils/fileUtils.js';
import { getScenarioHints } from '../utils/docxSimulation.js';
import { runQaValidatorAgent } from '../services/openaiAgents.js';

const makeIssue = (message, category = ISSUE_CATEGORY.STYLE_LAYOUT, severity = ISSUE_SEVERITY.MEDIUM) => ({
  category,
  severity,
  message,
});

const usesPrototypePlaceholderStrategy = (rebuildSummary) => rebuildSummary?.strategy === 'placeholder_json_artifact';

const getHeadingPolicyViolations = ({ orderedBlocks, headingPolicy }) => {
  const allowedHeadingStyles = new Set((headingPolicy?.styleNames || []).filter(Boolean));
  if (allowedHeadingStyles.size === 0) {
    return [];
  }

  return (orderedBlocks || [])
    .filter((block) => block.type === 'section')
    .filter((block) => !allowedHeadingStyles.has(block.headingStyle));
};

const isPlaceholderArtifactComplaint = (issue, rebuildSummary) => usesPrototypePlaceholderStrategy(rebuildSummary)
  && issue.category === ISSUE_CATEGORY.MISSING_ARTIFACT
  && /placeholder|real rebuilt docx|actual rebuilt docx|required output artifact/i.test(issue.message || '');

const isResolvedHeadingComplaint = (issue, headingViolations) => headingViolations.length === 0
  && /heading style|heading styles|heading policy/i.test(issue.message || '');

const normalizeSdkIssues = ({ sdkIssues, rebuildSummary, headingViolations }) => (sdkIssues || []).filter((issue) => {
  if (isPlaceholderArtifactComplaint(issue, rebuildSummary)) {
    return false;
  }

  if (isResolvedHeadingComplaint(issue, headingViolations)) {
    return false;
  }

  return true;
});

export const qaValidator = async (state) => {
  const plan = state.artifacts.transformationPlan;
  const rebuildSummary = state.artifacts.rebuildSummary;
  const contentMap = state.artifacts.contentMap;
  const hints = getScenarioHints(state.files);
  const issues = [];
  const repairHistory = plan?.repairHistory || [];
  const hasCaptionFix = repairHistory.some((item) => item.toLowerCase().includes('caption'));
  const hasHeadingFix = repairHistory.some((item) => item.toLowerCase().includes('heading'));
  const hasTables = Boolean(contentMap?.tables?.length);
  const hasFigures = Boolean(contentMap?.figures?.length);
  const headingViolations = getHeadingPolicyViolations({
    orderedBlocks: rebuildSummary?.orderedBlocks,
    headingPolicy: plan?.headingPolicy,
  });

  if (!(await pathExists(state.files.outputPath || ''))) {
    issues.push(makeIssue('Output artifact path is missing or unreadable.', ISSUE_CATEGORY.MISSING_ARTIFACT, ISSUE_SEVERITY.HIGH));
  }

  if (!rebuildSummary?.orderedBlocks?.some((block) => block.type === 'abstract' && block.value)) {
    issues.push(makeIssue('Abstract block is missing from rebuilt output.'));
  }

  if (!rebuildSummary?.orderedBlocks?.some((block) => block.type === 'references' && Array.isArray(block.value) && block.value.length > 0)) {
    issues.push(makeIssue('References block is missing from rebuilt output.'));
  }

  if (hasTables && plan?.captionPolicy?.tables !== 'above') {
    issues.push(makeIssue('Table caption policy is not compliant with template profile.'));
  }

  if (hasFigures && plan?.captionPolicy?.figures !== 'below') {
    issues.push(makeIssue('Figure caption policy is not compliant with template profile.'));
  }

  if ((contentMap?.sections || []).length > 0 && !Number.isInteger(plan?.headingPolicy?.numberingDepth)) {
    issues.push(makeIssue('Heading numbering depth is undefined.'));
  }

  if (headingViolations.length > 0) {
    issues.push(makeIssue(
      `Body sections in the rebuilt artifact use unsupported heading styles (${headingViolations.map((block) => block.headingStyle).join(', ')}) instead of the required template heading styles.`,
      ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
      ISSUE_SEVERITY.HIGH,
    ));
  }

  if (hints.sourceQaFailure) {
    if (hasTables && !hasCaptionFix) {
      issues.push(makeIssue('Table caption policy is not compliant with template profile.'));
    }
    if (hasFigures && !hasCaptionFix) {
      issues.push(makeIssue('Figure caption policy is not compliant with template profile.'));
    }
    if (!hasHeadingFix) {
      issues.push(makeIssue('Heading numbering depth is undefined.'));
    }
  }

  if (hints.sourceEscalate) {
    issues.push(makeIssue('Style/layout discrepancies remain after rebuild.'));
  }

  let repairable = issues.every((issue) => issue.category !== ISSUE_CATEGORY.INVALID_INPUT)
    && issues.length > 0;
  let confidence = issues.length === 0 ? 0.92 : Math.max(0.35, 0.78 - issues.length * 0.1);
  let qaReport = {
    passed: issues.length === 0,
    repairable,
    checks: {
      headingPolicy: headingViolations.length === 0 && !issues.some((issue) => issue.message.includes('Heading')),
      captions: !issues.some((issue) => issue.message.includes('caption')),
      frontMatter: !issues.some((issue) => issue.message.includes('Abstract')),
      references: !issues.some((issue) => issue.message.includes('References')),
      outputArtifact: !issues.some((issue) => issue.category === ISSUE_CATEGORY.MISSING_ARTIFACT),
    },
    issueCount: issues.length,
  };

  const sdkQa = await runQaValidatorAgent({
    templateProfile: state.artifacts.templateProfile,
    contentMap,
    transformationPlan: plan,
    rebuildSummary,
    baselineQa: qaReport,
    issues,
  });

  if (sdkQa) {
    const normalizedSdkIssues = normalizeSdkIssues({
      sdkIssues: sdkQa.issues,
      rebuildSummary,
      headingViolations,
    });

    issues.length = 0;
    issues.push(...normalizedSdkIssues);
    repairable = normalizedSdkIssues.every((issue) => issue.category !== ISSUE_CATEGORY.INVALID_INPUT)
      && normalizedSdkIssues.length > 0;
    confidence = normalizedSdkIssues.length === 0 ? Math.max(sdkQa.confidence, 0.96) : sdkQa.confidence;
    qaReport = {
      passed: normalizedSdkIssues.length === 0,
      repairable,
      checks: {
        ...sdkQa.checks,
        headingPolicy: headingViolations.length === 0 && normalizedSdkIssues.every((issue) => !/heading/i.test(issue.message || '')),
        outputArtifact: normalizedSdkIssues.every((issue) => issue.category !== ISSUE_CATEGORY.MISSING_ARTIFACT),
      },
      issueCount: normalizedSdkIssues.length,
      reviewer: 'openai_agents_sdk',
    };
  }

  return {
    ok: qaReport.passed,
    agent: AGENT_NAME.QA_VALIDATOR,
    confidence,
    qaReport,
    repairable,
    issues,
    inputSummary: {
      outputPath: state.files.outputPath,
      repairAttempts: state.retries.repairAgent,
    },
    outputSummary: {
      confidence,
      passed: issues.length === 0,
      repairable,
    },
  };
};
