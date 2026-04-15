export const createTraceEntry = ({ step, agent, inputSummary, outputSummary, confidence, issues }) => ({
  step,
  agent,
  timestamp: new Date().toISOString(),
  inputSummary,
  outputSummary,
  confidence,
  issues: issues || [],
});

export const createDecisionEntry = ({ fromStatus, decision, rationale, nextStatus }) => ({
  timestamp: new Date().toISOString(),
  fromStatus,
  decision,
  rationale,
  nextStatus,
});
