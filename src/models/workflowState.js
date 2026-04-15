import path from 'node:path';
import { createRunId } from '../utils/id.js';
import { RETRY_LIMITS, WORKFLOW_STATUS } from '../utils/constants.js';

export const createInitialState = ({ targetPath, submittedPath, outputRoot }) => {
  const runId = createRunId();
  const outputDir = path.join(outputRoot, runId);

  return {
    runId,
    status: WORKFLOW_STATUS.INIT,
    success: false,
    files: {
      targetPath,
      submittedPath,
      outputPath: null,
      outputDir,
    },
    artifacts: {
      templateProfile: null,
      contentMap: null,
      transformationPlan: null,
      qaReport: null,
      reviewItems: [],
      rebuildSummary: null,
      planValidation: null,
    },
    confidence: {
      templateProfile: 0,
      sourceAnalysis: 0,
      structureMapping: 0,
      rebuild: 0,
      qa: 0,
      repair: 0,
    },
    retries: {
      sourceAnalyzer: 0,
      structureMapper: 0,
      documentRebuilder: 0,
      repairAgent: 0,
    },
    retryLimits: { ...RETRY_LIMITS },
    issues: [],
    trace: [],
    decisions: [],
    escalation: {
      required: false,
      reasons: [],
    },
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
};
