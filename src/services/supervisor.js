import path from 'node:path';
import { templateProfiler } from '../agents/templateProfiler.js';
import { sourceAnalyzer } from '../agents/sourceAnalyzer.js';
import { structureMapper } from '../agents/structureMapper.js';
import { planValidator } from '../agents/planValidator.js';
import { documentRebuilder } from '../agents/documentRebuilder.js';
import { qaValidator } from '../agents/qaValidator.js';
import { repairAgent } from '../agents/repairAgent.js';
import { exceptionHandler } from '../agents/exceptionHandler.js';
import { createInitialState } from '../models/workflowState.js';
import { runSupervisorDecisionAgent } from './openaiAgents.js';
import { CONFIDENCE_THRESHOLDS, WORKFLOW_STATUS, OUTPUT_FILENAMES } from '../utils/constants.js';
import { addDecision, addEscalationReason, addIssue, addTrace, incrementRetry, isRepairable, setArtifact, setArtifacts, setConfidence, setOutputPath, setSuccess, shouldEscalate, updateStatus } from '../utils/stateHelpers.js';
import { ensureDir, writeJson } from '../utils/fileUtils.js';
import { logger } from '../utils/logger.js';

const hasFatalIssue = (result) => (result.issues || []).some((issue) => issue.severity === 'critical');

const mergeIssues = (state, issues) => {
  let nextState = state;
  for (const issue of issues || []) {
    nextState = addIssue(nextState, issue);
  }
  return nextState;
};

const applyAgentResult = (state, result) => {
  let nextState = mergeIssues(state, result.issues || []);
  nextState = addTrace(nextState, {
    step: nextState.trace.length + 1,
    agent: result.agent,
    inputSummary: result.inputSummary,
    outputSummary: result.outputSummary,
    confidence: result.confidence,
    issues: result.issues,
  });

  if (result.agent === 'templateProfiler' && result.templateProfile) {
    nextState = setArtifact(nextState, 'templateProfile', result.templateProfile);
    nextState = setConfidence(nextState, 'templateProfile', result.confidence);
    nextState = updateStatus(nextState, WORKFLOW_STATUS.PROFILED);
  }

  if (result.agent === 'sourceAnalyzer' && result.contentMap) {
    nextState = setArtifact(nextState, 'contentMap', result.contentMap);
    nextState = setConfidence(nextState, 'sourceAnalysis', result.confidence);
    nextState = updateStatus(nextState, WORKFLOW_STATUS.ANALYZED);
  }

  if (result.agent === 'structureMapper' && result.transformationPlan) {
    nextState = setArtifact(nextState, 'transformationPlan', result.transformationPlan);
    nextState = setConfidence(nextState, 'structureMapping', result.confidence);
    nextState = updateStatus(nextState, WORKFLOW_STATUS.MAPPED);
  }

  if (result.agent === 'planValidator' && result.planValidation) {
    nextState = setArtifact(nextState, 'planValidation', result.planValidation);
    nextState = updateStatus(nextState, result.ok ? WORKFLOW_STATUS.PLAN_VALID : WORKFLOW_STATUS.PLAN_INVALID);
  }

  if (result.agent === 'documentRebuilder' && result.rebuildSummary) {
    nextState = setArtifacts(nextState, { rebuildSummary: result.rebuildSummary });
    nextState = setConfidence(nextState, 'rebuild', result.confidence);
    nextState = setOutputPath(nextState, result.outputPath);
    nextState = updateStatus(nextState, WORKFLOW_STATUS.REBUILT);
  }

  if (result.agent === 'qaValidator' && result.qaReport) {
    nextState = setArtifact(nextState, 'qaReport', result.qaReport);
    nextState = setConfidence(nextState, 'qa', result.confidence);
    nextState = updateStatus(nextState, result.ok ? WORKFLOW_STATUS.QA_PASSED : WORKFLOW_STATUS.QA_FAILED);
  }

  if (result.agent === 'repairAgent') {
    if (result.updatedTransformationPlan) {
      nextState = setArtifact(nextState, 'transformationPlan', result.updatedTransformationPlan);
    }
    nextState = setConfidence(nextState, 'repair', result.confidence);
    nextState = updateStatus(nextState, WORKFLOW_STATUS.REPAIRING);
  }

  if (result.agent === 'exceptionHandler') {
    nextState = setArtifact(nextState, 'reviewItems', result.reviewItems || []);
    nextState = updateStatus(nextState, WORKFLOW_STATUS.ESCALATED);
  }

  return nextState;
};

const getPlanRoute = (state) => state.artifacts.planValidation?.recommendedRoute || 'structureMapper';

const getAllowedAgents = (state, fallbackDecision) => {
  const allowed = new Set([fallbackDecision.agent]);

  if (state.status === WORKFLOW_STATUS.ANALYZED && !shouldEscalate(state, 'sourceAnalyzer')) {
    allowed.add('sourceAnalyzer');
    allowed.add('structureMapper');
  }

  if (state.status === WORKFLOW_STATUS.PLAN_INVALID) {
    allowed.add('sourceAnalyzer');
    allowed.add('structureMapper');
    allowed.add('exceptionHandler');
  }

  if (state.status === WORKFLOW_STATUS.QA_FAILED) {
    allowed.add('repairAgent');
    allowed.add('exceptionHandler');
  }

  if (state.status === WORKFLOW_STATUS.REPAIRING) {
    allowed.add('documentRebuilder');
  }

  return Array.from(allowed);
};

export const decideNextStep = (state) => {
  switch (state.status) {
    case WORKFLOW_STATUS.INIT:
      return { agent: 'templateProfiler', rationale: 'Workflow initialization requires template profiling.' };
    case WORKFLOW_STATUS.PROFILED:
      return { agent: 'sourceAnalyzer', rationale: 'Template profile exists; analyze submitted content next.' };
    case WORKFLOW_STATUS.ANALYZED:
      if (state.confidence.sourceAnalysis < CONFIDENCE_THRESHOLDS.sourceAnalysis) {
        if (shouldEscalate(state, 'sourceAnalyzer')) {
          return { agent: 'exceptionHandler', rationale: 'Source analysis retry budget exhausted with low confidence.' };
        }
        return { agent: 'sourceAnalyzer', rationale: 'Analysis confidence below threshold; retry Loop A.' };
      }
      return { agent: 'structureMapper', rationale: 'Content analysis is sufficient for structure mapping.' };
    case WORKFLOW_STATUS.MAPPED:
      return { agent: 'planValidator', rationale: 'Transformation plan must be validated before rebuilding.' };
    case WORKFLOW_STATUS.PLAN_INVALID: {
      const route = getPlanRoute(state);
      if (route === 'sourceAnalyzer') {
        if (shouldEscalate(state, 'sourceAnalyzer')) {
          return { agent: 'exceptionHandler', rationale: 'Plan validation points to source analysis, but Loop A budget is exhausted.' };
        }
        return { agent: 'sourceAnalyzer', rationale: 'Plan validation surfaced semantic issues; loop back to source analyzer.' };
      }
      if (shouldEscalate(state, 'structureMapper')) {
        return { agent: 'exceptionHandler', rationale: 'Plan validation failed after mapper retry budget was exhausted.' };
      }
      return { agent: 'structureMapper', rationale: 'Plan validation failed on style/layout details; loop back to structure mapper.' };
    }
    case WORKFLOW_STATUS.PLAN_VALID:
      return { agent: 'documentRebuilder', rationale: 'Validated plan is ready for rebuild.' };
    case WORKFLOW_STATUS.REBUILT:
      return { agent: 'qaValidator', rationale: 'Rebuilt artifact must pass QA before completion.' };
    case WORKFLOW_STATUS.QA_FAILED:
      if (isRepairable(state.artifacts.qaReport)) {
        if (shouldEscalate(state, 'repairAgent') || shouldEscalate(state, 'documentRebuilder')) {
          return { agent: 'exceptionHandler', rationale: 'Repair loop budget exhausted after repeated QA failures.' };
        }
        return { agent: 'repairAgent', rationale: 'QA failures are repairable; enter Loop C.' };
      }
      return { agent: 'exceptionHandler', rationale: 'QA failures are not repairable automatically.' };
    case WORKFLOW_STATUS.REPAIRING:
      return { agent: 'documentRebuilder', rationale: 'Repair fixes were applied; rebuild again.' };
    case WORKFLOW_STATUS.QA_PASSED:
      return { agent: 'done', rationale: 'Success criteria met.' };
    case WORKFLOW_STATUS.ESCALATED:
    case WORKFLOW_STATUS.DONE:
    default:
      return { agent: 'done', rationale: 'Workflow has reached a terminal state.' };
  }
};

const maybeIncrementRetry = (state, agentName) => {
  if (agentName === 'sourceAnalyzer' && state.status === WORKFLOW_STATUS.ANALYZED) {
    return incrementRetry(state, 'sourceAnalyzer');
  }
  if (agentName === 'sourceAnalyzer' && state.status === WORKFLOW_STATUS.PLAN_INVALID) {
    return incrementRetry(state, 'sourceAnalyzer');
  }
  if (agentName === 'structureMapper' && state.status === WORKFLOW_STATUS.PLAN_INVALID) {
    return incrementRetry(state, 'structureMapper');
  }
  if (agentName === 'repairAgent' && state.status === WORKFLOW_STATUS.QA_FAILED) {
    return incrementRetry(state, 'repairAgent');
  }
  if (agentName === 'documentRebuilder' && state.status === WORKFLOW_STATUS.REPAIRING) {
    return incrementRetry(state, 'documentRebuilder');
  }
  return state;
};

const persistArtifacts = async (state) => {
  const outputDir = state.files.outputDir;
  await ensureDir(outputDir);

  await writeJson(path.join(outputDir, OUTPUT_FILENAMES.TEMPLATE_PROFILE), state.artifacts.templateProfile);
  await writeJson(path.join(outputDir, OUTPUT_FILENAMES.CONTENT_MAP), state.artifacts.contentMap);
  await writeJson(path.join(outputDir, OUTPUT_FILENAMES.TRANSFORMATION_PLAN), state.artifacts.transformationPlan);
  await writeJson(path.join(outputDir, OUTPUT_FILENAMES.QA_REPORT), state.artifacts.qaReport);
  await writeJson(path.join(outputDir, OUTPUT_FILENAMES.REVIEW_ITEMS), state.artifacts.reviewItems || []);
  await writeJson(path.join(outputDir, OUTPUT_FILENAMES.TRACE), {
    trace: state.trace,
    decisions: state.decisions,
  });
};

const getAgentRunner = (name) => ({
  templateProfiler,
  sourceAnalyzer,
  structureMapper,
  planValidator,
  documentRebuilder,
  qaValidator,
  repairAgent,
  exceptionHandler,
}[name]);

export const createSupervisor = ({ store, outputRoot }) => {
  const runWorkflow = async ({ targetPath, submittedPath }) => {
    let state = createInitialState({ targetPath, submittedPath, outputRoot });
    store.save(state);
    logger.info('workflow.start', { runId: state.runId, targetPath, submittedPath });

    let safetyCounter = 0;
    while (state.status !== WORKFLOW_STATUS.DONE && state.status !== WORKFLOW_STATUS.ESCALATED) {
      safetyCounter += 1;
      if (safetyCounter > 25) {
        const escalation = await exceptionHandler(state, ['Supervisor safety counter exceeded.']);
        state = applyAgentResult(state, escalation);
        break;
      }

      const fallbackDecision = decideNextStep(state);
      const allowedAgents = getAllowedAgents(state, fallbackDecision);
      const sdkDecision = await runSupervisorDecisionAgent({
        state,
        allowedAgents,
        fallbackDecision,
      });
      const decision = sdkDecision && allowedAgents.includes(sdkDecision.agent)
        ? sdkDecision
        : fallbackDecision;
      state = addDecision(state, {
        fromStatus: state.status,
        decision: decision.agent,
        rationale: decision.rationale,
        nextStatus: decision.agent === 'done' ? WORKFLOW_STATUS.DONE : state.status,
      });
      logger.info('workflow.decision', { runId: state.runId, status: state.status, decision: decision.agent, rationale: decision.rationale });

      if (decision.agent === 'done') {
        state = updateStatus(state, WORKFLOW_STATUS.DONE);
        state = setSuccess(state, !state.escalation.required);
        break;
      }

      if (decision.agent === 'exceptionHandler') {
        const reasons = [decision.rationale, ...state.issues.slice(-3).map((issue) => issue.message)];
        state = addEscalationReason(state, decision.rationale);
        const escalationResult = await exceptionHandler(state, reasons);
        state = applyAgentResult(state, escalationResult);
        break;
      }

      state = maybeIncrementRetry(state, decision.agent);
      const runner = getAgentRunner(decision.agent);
      logger.info('agent.invoke', { runId: state.runId, agent: decision.agent, retries: state.retries });

      try {
        const result = await runner(state);
        state = applyAgentResult(state, result);
        store.save(state);
        logger.info('agent.complete', { runId: state.runId, agent: decision.agent, ok: result.ok, confidence: result.confidence });

        if (decision.agent === 'repairAgent' && !result.ok) {
          state = addEscalationReason(state, 'Repair agent could not propose concrete fixes.');
          const escalationResult = await exceptionHandler(state, state.escalation.reasons);
          state = applyAgentResult(state, escalationResult);
          break;
        }

        if (hasFatalIssue(result)) {
          state = addEscalationReason(state, `${decision.agent} reported a fatal issue.`);
          const escalationResult = await exceptionHandler(state, state.escalation.reasons);
          state = applyAgentResult(state, escalationResult);
          break;
        }
      } catch (error) {
        logger.error('agent.failure', { runId: state.runId, agent: decision.agent, message: error.message });
        state = addIssue(state, {
          category: 'invalid_input',
          severity: 'critical',
          message: `${decision.agent} failed: ${error.message}`,
        });
        state = addEscalationReason(state, `${decision.agent} threw an unhandled error.`);
        const escalationResult = await exceptionHandler(state, state.escalation.reasons);
        state = applyAgentResult(state, escalationResult);
        break;
      }
    }

    if (state.status === WORKFLOW_STATUS.QA_PASSED) {
      state = updateStatus(state, WORKFLOW_STATUS.DONE);
      state = setSuccess(state, true);
    }

    if (state.status === WORKFLOW_STATUS.ESCALATED) {
      state = setSuccess(state, false);
    }

    await persistArtifacts(state);
    store.save(state);
    logger.info('workflow.complete', { runId: state.runId, status: state.status, success: state.success });
    return state;
  };

  return {
    runWorkflow,
    decideNextStep,
  };
};
