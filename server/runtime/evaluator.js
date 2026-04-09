export const createEvaluator = () => ({
  evaluate({ task, response, toolResults }) {
    const checks = [
      {
        name: 'response-produced',
        passed: Boolean(response.answer && response.answer.trim()),
      },
      {
        name: 'task-classification-present',
        passed: Boolean(task.type),
      },
      {
        name: 'tool-path-consistent',
        passed: task.type !== 'calculation' || toolResults.some((result) => result.tool === 'calculator'),
      },
    ];

    return {
      passed: checks.every((check) => check.passed),
      checks,
    };
  },
});
