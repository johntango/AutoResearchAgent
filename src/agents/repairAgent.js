import { AGENT_NAME, ISSUE_CATEGORY, ISSUE_SEVERITY } from '../utils/constants.js';
import { runRepairAgent as runOpenAiRepairAgent } from '../services/openaiAgents.js';

const applyFix = (plan, issue) => {
  const updated = structuredClone(plan);
  const fixes = [];
  const message = String(issue.message || '').toLowerCase();

  if (message.includes('abstract')) {
    updated.frontMatterPolicy = {
      ...updated.frontMatterPolicy,
      order: ['title', 'authors', 'affiliations', 'abstract', 'keywords'],
      abstractBeforeKeywords: true,
    };
    fixes.push('Forced abstract before keywords in front matter order.');
  }

  if (message.includes('references')) {
    updated.referencePolicy = {
      ...updated.referencePolicy,
      location: 'end',
      style: 'References',
      numbering: 'sequential',
    };
    fixes.push('Restored references-at-end strategy with sequential numbering.');
  }

  if (message.includes('table caption')) {
    updated.captionPolicy = {
      ...updated.captionPolicy,
      tables: 'above',
    };
    fixes.push('Reset table captions to above-table placement.');
  }

  if (message.includes('figure caption')) {
    updated.captionPolicy = {
      ...updated.captionPolicy,
      figures: 'below',
    };
    fixes.push('Reset figure captions to below-figure placement.');
  }

  if (message.includes('heading')) {
    updated.headingPolicy = {
      ...updated.headingPolicy,
      numberingDepth: 2,
      lowerLevels: 'run_in',
    };
    fixes.push('Reinstated default heading numbering depth and lower-level run-in policy.');
  }

  return {
    updated,
    fixes,
  };
};

const applyDirectiveFixes = (plan, directives) => {
  const updated = structuredClone(plan);
  const fixes = [];

  if (directives?.abstractBeforeKeywords) {
    updated.frontMatterPolicy = {
      ...updated.frontMatterPolicy,
      abstractBeforeKeywords: true,
      order: ['title', 'authors', 'affiliations', 'abstract', 'keywords'],
    };
    fixes.push('Applied SDK repair: abstract before keywords.');
  }

  if (directives?.referencesAtEnd) {
    updated.referencePolicy = {
      ...updated.referencePolicy,
      location: 'end',
      numbering: 'sequential',
    };
    fixes.push('Applied SDK repair: references at end with sequential numbering.');
  }

  if (directives?.tableCaptionPosition && directives.tableCaptionPosition !== 'unchanged') {
    updated.captionPolicy = {
      ...updated.captionPolicy,
      tables: directives.tableCaptionPosition,
    };
    fixes.push(`Applied SDK repair: table captions ${directives.tableCaptionPosition}.`);
  }

  if (directives?.figureCaptionPosition && directives.figureCaptionPosition !== 'unchanged') {
    updated.captionPolicy = {
      ...updated.captionPolicy,
      figures: directives.figureCaptionPosition,
    };
    fixes.push(`Applied SDK repair: figure captions ${directives.figureCaptionPosition}.`);
  }

  if (Number.isInteger(directives?.headingNumberingDepth)) {
    updated.headingPolicy = {
      ...updated.headingPolicy,
      numberingDepth: directives.headingNumberingDepth,
      lowerLevels: directives.lowerHeadingStyle || updated.headingPolicy?.lowerLevels || 'run_in',
    };
    fixes.push('Applied SDK repair: heading numbering depth updated.');
  }

  return { updated, fixes };
};

export const repairAgent = async (state) => {
  const qaReport = state.artifacts.qaReport;
  const plan = state.artifacts.transformationPlan;

  if (!qaReport || !plan) {
    return {
      ok: false,
      agent: AGENT_NAME.REPAIR_AGENT,
      confidence: 0,
      appliedFixes: [],
      updatedTransformationPlan: null,
      issues: [{
        category: ISSUE_CATEGORY.MISSING_ARTIFACT,
        severity: ISSUE_SEVERITY.CRITICAL,
        message: 'Repair agent requires QA report and transformation plan.',
      }],
      inputSummary: {},
      outputSummary: {},
    };
  }

  const updatedPlan = structuredClone(plan);
  let appliedFixes = [];

  for (const issue of state.issues.filter((entry) => entry.category === ISSUE_CATEGORY.STYLE_LAYOUT || entry.category === ISSUE_CATEGORY.MISSING_ARTIFACT)) {
    const result = applyFix(updatedPlan, issue);
    Object.assign(updatedPlan, result.updated);
    appliedFixes.push(...result.fixes);
  }

  updatedPlan.repairHistory = [
    ...(updatedPlan.repairHistory || []),
    ...appliedFixes,
  ];

  const sdkRepair = await runOpenAiRepairAgent({
    transformationPlan: updatedPlan,
    qaReport,
    issues: state.issues,
  });

  if (sdkRepair) {
    const directiveResult = applyDirectiveFixes(updatedPlan, sdkRepair.directives);
    Object.assign(updatedPlan, directiveResult.updated);
    appliedFixes = [...appliedFixes, ...sdkRepair.appliedFixes, ...directiveResult.fixes];
    updatedPlan.repairHistory = [
      ...(updatedPlan.repairHistory || []),
      ...sdkRepair.appliedFixes,
      ...directiveResult.fixes,
    ];
  }

  const issues = [];
  if (appliedFixes.length === 0) {
    issues.push({
      category: ISSUE_CATEGORY.STYLE_LAYOUT,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Repair agent found no targeted fixes to apply.',
    });
  }

  return {
    ok: appliedFixes.length > 0,
    agent: AGENT_NAME.REPAIR_AGENT,
    confidence: appliedFixes.length > 0 ? 0.84 : 0.45,
    appliedFixes,
    updatedTransformationPlan: updatedPlan,
    issues,
    inputSummary: {
      qaIssueCount: qaReport.issueCount,
    },
    outputSummary: {
      appliedFixCount: appliedFixes.length,
    },
  };
};
