import { AGENT_NAME, ISSUE_CATEGORY, ISSUE_SEVERITY } from '../utils/constants.js';
import { runPlanValidatorAgent } from '../services/openaiAgents.js';

const hasFrontMatter = (plan) => Array.isArray(plan?.frontMatterPolicy?.order) && plan.frontMatterPolicy.order.length >= 3;
const hasHeadingRules = (plan) => Number.isInteger(plan?.headingPolicy?.numberingDepth);
const hasCaptionPolicy = (plan) => Boolean(plan?.captionPolicy?.tables) && Boolean(plan?.captionPolicy?.figures);
const hasReferencePolicy = (plan) => Boolean(plan?.referencePolicy?.location);
const requiresCaptionPolicy = (contentMap) => Boolean(contentMap?.tables?.length) || Boolean(contentMap?.figures?.length);

export const planValidator = async (state) => {
  const plan = state.artifacts.transformationPlan;
  const contentMap = state.artifacts.contentMap;
  const issues = [];

  if (!plan) {
    issues.push({
      category: ISSUE_CATEGORY.MISSING_ARTIFACT,
      severity: ISSUE_SEVERITY.CRITICAL,
      message: 'Transformation plan is missing.',
      routeTo: 'structureMapper',
    });
  }

  if (plan && !hasFrontMatter(plan)) {
    issues.push({
      category: ISSUE_CATEGORY.STYLE_LAYOUT,
      severity: ISSUE_SEVERITY.HIGH,
      message: 'Front matter policy is incomplete.',
      routeTo: 'structureMapper',
    });
  }

  if (plan && !hasHeadingRules(plan)) {
    issues.push({
      category: ISSUE_CATEGORY.STYLE_LAYOUT,
      severity: ISSUE_SEVERITY.HIGH,
      message: 'Heading policy is not fully defined.',
      routeTo: 'structureMapper',
    });
  }

  if (plan && requiresCaptionPolicy(contentMap) && !hasCaptionPolicy(plan)) {
    issues.push({
      category: ISSUE_CATEGORY.STYLE_LAYOUT,
      severity: ISSUE_SEVERITY.HIGH,
      message: 'Caption placement rules are missing.',
      routeTo: 'structureMapper',
    });
  }

  if (plan && !hasReferencePolicy(plan)) {
    issues.push({
      category: ISSUE_CATEGORY.STYLE_LAYOUT,
      severity: ISSUE_SEVERITY.HIGH,
      message: 'Reference handling policy is missing.',
      routeTo: 'structureMapper',
    });
  }

  if (contentMap && !contentMap.abstract) {
    issues.push({
      category: ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Plan validation detected missing abstract content.',
      routeTo: 'sourceAnalyzer',
    });
  }

  if (contentMap && !contentMap.references.length) {
    issues.push({
      category: ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
      severity: ISSUE_SEVERITY.MEDIUM,
      message: 'Plan validation detected missing references.',
      routeTo: 'sourceAnalyzer',
    });
  }

  let confidence = issues.length === 0 ? 0.91 : Math.max(0.4, 0.82 - issues.length * 0.12);
  let planValidation = {
    valid: issues.length === 0,
    checkedAt: new Date().toISOString(),
    issueCount: issues.length,
    recommendedRoute: issues[0]?.routeTo || null,
  };

  const sdkValidation = await runPlanValidatorAgent({
    templateProfile: state.artifacts.templateProfile,
    contentMap,
    transformationPlan: plan,
    baselineValidation: planValidation,
    issues,
  });

  if (sdkValidation) {
    issues.length = 0;
    issues.push(...sdkValidation.issues);
    confidence = sdkValidation.confidence;
    planValidation = {
      valid: sdkValidation.valid,
      checkedAt: new Date().toISOString(),
      issueCount: sdkValidation.issues.length,
      recommendedRoute: sdkValidation.recommendedRoute,
    };
  }

  return {
    ok: planValidation.valid,
    agent: AGENT_NAME.PLAN_VALIDATOR,
    confidence,
    planValidation,
    issues,
    inputSummary: {
      blockPlanLength: plan?.blockPlan?.length || 0,
    },
    outputSummary: {
      confidence,
      valid: issues.length === 0,
    },
  };
};
