const createEpisode = ({ task, plan, response, evaluation, toolResults }) => ({
  id: `episode-${Date.now()}`,
  kind: 'episode',
  summary: `${task.type} task processed with ${toolResults.length} tool invocation(s).`,
  detail: response.answer,
  task: task.input,
  plan: plan.steps,
  evaluation,
  toolResults,
  createdAt: new Date().toISOString(),
});

export const createAgentController = ({ planner, memoryManager, modelAdapter, evaluator, consolidator, sessionManager }) => ({
  async run({ input, sessionId, responseMode }) {
    const task = {
      input,
      type: planner.classifyTask(input),
    };

    const session = await sessionManager.getSession(sessionId);
    const retrieved = await memoryManager.retrieve(task);
    const plan = planner.buildPlan(task);
    const response = await modelAdapter.generateResponse({
      task,
      plan,
      retrieved,
      session,
      responseMode,
    });
    const evaluation = evaluator.evaluate({
      task,
      response,
      toolResults: response.toolResults,
    });

    const episode = createEpisode({
      task,
      plan,
      response,
      evaluation,
      toolResults: response.toolResults,
    });

    await memoryManager.writeEpisode(episode);
    await sessionManager.saveSession({
      sessionId: session.id,
      previousResponseId: response.previousResponseId,
    });
    const consolidation = await consolidator.run();

    return {
      sessionId: session.id,
      task,
      retrieved,
      plan,
      response,
      evaluation,
      toolResults: response.toolResults,
      availableTools: response.availableTools,
      sdkItems: response.sdkItems,
      usage: response.usage,
      consolidation,
      episode,
    };
  },
});
