import { createDecisionEntry, createTraceEntry } from '../services/trace.js';

export const cloneState = (state) => structuredClone(state);

export const touchState = (state) => ({
  ...state,
  metadata: {
    ...state.metadata,
    updatedAt: new Date().toISOString(),
  },
});

export const updateStatus = (state, status) => touchState({ ...state, status });

export const addTrace = (state, payload) => touchState({
  ...state,
  trace: [...state.trace, createTraceEntry(payload)],
});

export const addDecision = (state, payload) => touchState({
  ...state,
  decisions: [...state.decisions, createDecisionEntry(payload)],
});

export const addIssue = (state, issue) => touchState({
  ...state,
  issues: [...state.issues, issue],
});

export const setArtifact = (state, key, value) => touchState({
  ...state,
  artifacts: {
    ...state.artifacts,
    [key]: value,
  },
});

export const setArtifacts = (state, artifactPatch) => touchState({
  ...state,
  artifacts: {
    ...state.artifacts,
    ...artifactPatch,
  },
});

export const setConfidence = (state, key, value) => touchState({
  ...state,
  confidence: {
    ...state.confidence,
    [key]: value,
  },
});

export const incrementRetry = (state, key) => touchState({
  ...state,
  retries: {
    ...state.retries,
    [key]: (state.retries[key] || 0) + 1,
  },
});

export const setOutputPath = (state, outputPath) => touchState({
  ...state,
  files: {
    ...state.files,
    outputPath,
  },
});

export const setSuccess = (state, success) => touchState({
  ...state,
  success,
});

export const addEscalationReason = (state, reason) => touchState({
  ...state,
  escalation: {
    required: true,
    reasons: [...state.escalation.reasons, reason],
  },
});

export const shouldEscalate = (state, retryKey) => (state.retries[retryKey] || 0) >= (state.retryLimits[retryKey] || 0);

export const isRepairable = (qaReport) => Boolean(qaReport?.repairable);
