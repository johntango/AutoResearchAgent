import { Agent, run } from '@openai/agents';
import { z } from 'zod';
import { ISSUE_CATEGORY, ISSUE_SEVERITY } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const MODEL = process.env.OPENAI_AGENTS_MODEL || 'gpt-5.4';

const issueSchema = z.object({
  category: z.enum([
    ISSUE_CATEGORY.SEMANTIC_STRUCTURE,
    ISSUE_CATEGORY.STYLE_LAYOUT,
    ISSUE_CATEGORY.MISSING_ARTIFACT,
    ISSUE_CATEGORY.INVALID_INPUT,
    ISSUE_CATEGORY.AMBIGUOUS_CONTENT,
  ]),
  severity: z.enum([
    ISSUE_SEVERITY.LOW,
    ISSUE_SEVERITY.MEDIUM,
    ISSUE_SEVERITY.HIGH,
    ISSUE_SEVERITY.CRITICAL,
  ]),
  message: z.string(),
  routeTo: z.enum(['sourceAnalyzer', 'structureMapper', 'repairAgent', 'documentRebuilder', 'exceptionHandler']).optional(),
});

const decisionSchema = z.object({
  agent: z.enum([
    'templateProfiler',
    'sourceAnalyzer',
    'structureMapper',
    'planValidator',
    'documentRebuilder',
    'qaValidator',
    'repairAgent',
    'exceptionHandler',
    'done',
  ]),
  rationale: z.string(),
});

const transformationPlanSchema = z.object({
  sectionOrder: z.array(z.string()),
  headingPolicy: z.object({
    numberingDepth: z.number().int(),
    styleNames: z.array(z.string()),
    lowerLevels: z.string(),
  }),
  captionPolicy: z.object({
    tables: z.string(),
    figures: z.string(),
  }),
  referencePolicy: z.object({
    location: z.string(),
    style: z.string(),
    numbering: z.string(),
  }),
  frontMatterPolicy: z.object({
    order: z.array(z.string()),
    abstractBeforeKeywords: z.boolean(),
    titleStyle: z.string(),
    authorStyle: z.string(),
  }),
  structureRequirements: z.object({
    required: z.array(z.string()),
    optional: z.array(z.string()),
  }).optional(),
  blockPlan: z.array(z.string()),
  repairHistory: z.array(z.string()).default([]),
  planner: z.string().optional(),
});

const planValidationSchema = z.object({
  valid: z.boolean(),
  recommendedRoute: z.enum(['sourceAnalyzer', 'structureMapper', 'repairAgent', 'documentRebuilder', 'exceptionHandler']).nullable(),
  issues: z.array(issueSchema),
  confidence: z.number().min(0).max(1),
});

const qaSchema = z.object({
  passed: z.boolean(),
  repairable: z.boolean(),
  checks: z.object({
    headingPolicy: z.boolean(),
    captions: z.boolean(),
    frontMatter: z.boolean(),
    references: z.boolean(),
    outputArtifact: z.boolean(),
  }),
  issues: z.array(issueSchema),
  confidence: z.number().min(0).max(1),
});

const repairSchema = z.object({
  appliedFixes: z.array(z.string()),
  directives: z.object({
    abstractBeforeKeywords: z.boolean().optional(),
    referencesAtEnd: z.boolean().optional(),
    tableCaptionPosition: z.enum(['above', 'below', 'unchanged']).optional(),
    figureCaptionPosition: z.enum(['above', 'below', 'unchanged']).optional(),
    headingNumberingDepth: z.number().int().nullable().optional(),
    lowerHeadingStyle: z.string().optional(),
  }),
  confidence: z.number().min(0).max(1),
});

export const canUseOpenAiAgents = () => Boolean(process.env.OPENAI_API_KEY) && process.env.OPENAI_AGENTS_DISABLED !== '1';

const createAgent = ({ name, instructions, outputType }) => new Agent({
  name,
  model: MODEL,
  instructions,
  outputType,
});

const runStructuredAgent = async ({ name, instructions, input, outputType }) => {
  if (!canUseOpenAiAgents()) {
    return null;
  }

  try {
    const agent = createAgent({ name, instructions, outputType });
    const result = await run(agent, typeof input === 'string' ? input : JSON.stringify(input, null, 2));
    if (!result?.finalOutput) {
      return null;
    }
    return result.finalOutput;
  } catch (error) {
    logger.warn('openai_agents.fallback', { name, message: error.message });
    return null;
  }
};

export const runSupervisorDecisionAgent = async ({ state, allowedAgents, fallbackDecision }) => runStructuredAgent({
  name: 'WorkflowSupervisor',
  instructions: [
    'You are a workflow supervisor for a document reformatting agent graph.',
    'Choose the next agent from the allowed list only.',
    'Respect bounded retries, escalation, and current workflow status.',
    'Prefer the provided fallback decision when the state clearly matches it.',
  ].join(' '),
  input: {
    allowedAgents,
    fallbackDecision,
    stateSummary: {
      runId: state.runId,
      status: state.status,
      confidence: state.confidence,
      retries: state.retries,
      recentIssues: state.issues.slice(-5),
      escalation: state.escalation,
      artifactsPresent: {
        templateProfile: Boolean(state.artifacts.templateProfile),
        contentMap: Boolean(state.artifacts.contentMap),
        transformationPlan: Boolean(state.artifacts.transformationPlan),
        qaReport: Boolean(state.artifacts.qaReport),
      },
    },
  },
  outputType: decisionSchema,
});

export const runStructureMapperAgent = async ({ templateProfile, contentMap, baselinePlan, issues }) => runStructuredAgent({
  name: 'StructureMapper',
  instructions: [
    'You produce a transformation plan for reformatting a submitted paper to match a target style template.',
    'Do not change submitted content semantics.',
    'Return only a valid transformation plan object.',
    'Preserve references at end, front matter ordering, and caption placement policy when supported by the target profile.',
    'Lists, tables, and figures are optional structures unless they are present in submitted content or explicitly marked required.',
  ].join(' '),
  input: {
    templateProfile,
    contentMap,
    baselinePlan,
    knownIssues: issues,
  },
  outputType: transformationPlanSchema,
});

export const runPlanValidatorAgent = async ({ templateProfile, contentMap, transformationPlan, baselineValidation, issues }) => runStructuredAgent({
  name: 'PlanValidator',
  instructions: [
    'You validate a document transformation plan before rebuild.',
    'Identify whether failures should route back to source analysis or structure mapping.',
    'Be strict about missing abstract, references, heading rules, caption policy, and front matter mapping.',
    'Do not treat target-only optional structures such as lists, tables, or figures as missing-content errors when the submitted document does not contain them.',
  ].join(' '),
  input: {
    templateProfile,
    contentMap,
    transformationPlan,
    baselineValidation,
    knownIssues: issues,
  },
  outputType: planValidationSchema,
});

export const runQaValidatorAgent = async ({ templateProfile, contentMap, transformationPlan, rebuildSummary, baselineQa, issues }) => runStructuredAgent({
  name: 'QaValidator',
  instructions: [
    'You evaluate whether a rebuilt document artifact matches the template style requirements.',
    'Classify issues into style_layout, semantic_structure, missing_artifact, invalid_input, or ambiguous_content.',
    'Optional structures present in the target but absent in submitted content are not QA failures; only validate lists, tables, and figures when the submitted content or plan requires them.',
    'This repository is a prototype that intentionally writes a placeholder artifact summary instead of a real DOCX. Do not report that prototype strategy itself as a missing artifact as long as the declared output artifact exists and the summary matches the plan.',
    'For heading policy, validate the actual headingStyle values in section blocks against transformationPlan.headingPolicy.styleNames.',
    'Mark QA as repairable only when targeted plan fixes are realistic.',
  ].join(' '),
  input: {
    templateProfile,
    contentMap,
    transformationPlan,
    rebuildSummary,
    baselineQa,
    knownIssues: issues,
  },
  outputType: qaSchema,
});

export const runRepairAgent = async ({ transformationPlan, qaReport, issues }) => runStructuredAgent({
  name: 'RepairPlanner',
  instructions: [
    'You propose concrete plan-level fixes for style/layout QA failures.',
    'Do not suggest generic retries.',
    'Return precise directives for headings, caption positions, references, and abstract placement.',
  ].join(' '),
  input: {
    transformationPlan,
    qaReport,
    issues,
  },
  outputType: repairSchema,
});
