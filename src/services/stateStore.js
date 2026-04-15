const workflowMap = new Map();

export const stateStore = {
  save(state) {
    workflowMap.set(state.runId, structuredClone(state));
    return state;
  },
  get(runId) {
    const value = workflowMap.get(runId);
    return value ? structuredClone(value) : null;
  },
  list() {
    return Array.from(workflowMap.values()).map((state) => structuredClone(state));
  },
};
