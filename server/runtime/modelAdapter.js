import { Agent, Runner } from '@openai/agents';

const summarizeMemories = (memories) => {
  if (!memories.length) {
    return 'No prior memory was retrieved.';
  }

  return memories
    .slice(0, 5)
    .map((entry) => `- ${entry.kind}: ${entry.summary}`)
    .join('\n');
};

const formatPlan = (plan) => plan.steps.map((step, index) => `${index + 1}. ${step}`).join('\n');

const stripLinksAndCitations = (text) =>
  text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/gi, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\(\s*utm_[^)]+\)/gi, '')
    .replace(/\[\d+\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const outputRulesForMode = (responseMode) => {
  if (responseMode === 'detailed') {
    return [
      'Response style requirements:',
      '- Be structured and detailed, but keep sections focused.',
      '- Do not include URLs, citations, or source footnotes in the final answer.',
      '- Use plain markdown headings and bullets only when needed.',
    ].join('\n');
  }

  return [
    'Response style requirements:',
    '- Be concise: maximum 8 bullets or short paragraphs total.',
    '- Prefer direct recommendations over long background explanations.',
    '- Do not include URLs, citations, or source footnotes in the final answer.',
  ].join('\n');
};

const buildInstructions = ({ task, plan, retrieved, responseMode }) => [
  'You are the controller for a minimal learning system that must not change model weights.',
  'Use external memory, tool calls, and concise reasoning to answer the user request.',
  'When recent or factual information matters, use the web search tool.',
  'When math is involved, use the calculator tool instead of mental arithmetic.',
  'Use the memory tools when they help ground the answer in retrieved facts, procedures, or episodes.',
  outputRulesForMode(responseMode),
  '',
  `Task type: ${task.type}`,
  'Runtime plan:',
  formatPlan(plan),
  '',
  'Retrieved memory summary:',
  summarizeMemories([
    ...retrieved.facts,
    ...retrieved.episodes,
    ...retrieved.procedures,
  ]),
].join('\n');

const extractRunItems = (result) =>
  (result.newItems || []).map((item, index) => ({
    id: item.rawItem?.call_id || item.rawItem?.id || `run-item-${index}`,
    type: item.type || item.constructor?.name || 'unknown',
    name: item.rawItem?.name || item.rawItem?.type || item.toolName || 'n/a',
  }));

export const createModelAdapter = ({ toolRouter }) => {
  const runner = new Runner({
    workflowName: 'auto-research-agent',
    traceMetadata: {
      app: 'AutoResearchAgent',
    },
  });

  return {
    async generateResponse({ task, plan, retrieved, session, responseMode }) {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set. Provide it before calling /api/chat.');
      }

      const toolResults = [];
      const { tools, availableTools } = toolRouter.buildTools({
        retrieved,
        traceCollector: toolResults,
      });

      const agent = new Agent({
        name: 'MinimalLearningSystem',
        model: 'gpt-5.4',
        instructions: buildInstructions({ task, plan, retrieved, responseMode }),
        tools,
      });

      const prompt = [
        `User request: ${task.input}`,
        '',
        'Answer using the runtime plan and external memory. Mention when a tool materially affected the answer.',
      ].join('\n');

      const result = await runner.run(agent, prompt, {
        maxTurns: 8,
        previousResponseId: session.previousResponseId || undefined,
      });

      return {
        answer: stripLinksAndCitations(String(result.finalOutput ?? '').trim()),
        citations: retrieved.facts.slice(0, 2).map((item) => item.id),
        toolResults,
        availableTools,
        previousResponseId: result.lastResponseId || null,
        sdkItems: extractRunItems(result),
        usage: result.state?.usage || null,
      };
    },
  };
};
