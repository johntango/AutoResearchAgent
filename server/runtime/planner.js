const classifyTask = (input) => {
  const lowered = input.toLowerCase();
  if (lowered.includes('calculate') || /\d+[\+\-\*\/]/.test(lowered)) {
    return 'calculation';
  }
  if (lowered.includes('search') || lowered.includes('research')) {
    return 'research';
  }
  return 'conversation';
};

export const createPlanner = () => ({
  classifyTask,
  buildPlan(task) {
    const common = [
      'Retrieve facts, similar episodes, and relevant procedures.',
      'Build a context package for the response.',
    ];

    if (task.type === 'calculation') {
      return {
        steps: [...common, 'Run calculator tool.', 'Evaluate the numerical result.'],
      };
    }

    if (task.type === 'research') {
      return {
        steps: [...common, 'Run web search tool.', 'Synthesize findings into a concise response.'],
      };
    }

    return {
      steps: [...common, 'Draft response.', 'Evaluate coherence before returning output.'],
    };
  },
});
