import { tool, webSearchTool } from '@openai/agents';
import { z } from 'zod';

const safeEval = (expression) => {
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    return 'Rejected unsafe expression.';
  }

  try {
    return Function(`'use strict'; return (${expression});`)().toString();
  } catch {
    return 'Could not evaluate expression.';
  }
};

const pushTrace = (traceCollector, toolName, output) => {
  traceCollector.push({
    tool: toolName,
    output: typeof output === 'string' ? output : JSON.stringify(output),
  });
};

export const createToolRouter = ({ memoryManager }) => ({
  buildTools({ retrieved, traceCollector }) {
    const calculator = tool({
      name: 'calculator',
      description: 'Evaluate a simple arithmetic expression for numeric tasks.',
      parameters: z.object({
        expression: z.string().describe('Arithmetic expression containing only numbers and operators.'),
      }),
      async execute({ expression }) {
        const output = safeEval(expression);
        pushTrace(traceCollector, 'calculator', output);
        return output;
      },
    });

    const memoryReport = tool({
      name: 'memory_report',
      description: 'Inspect retrieved facts, procedures, and episodes before answering.',
      parameters: z.object({
        scope: z.enum(['facts', 'procedures', 'episodes', 'all']).default('all'),
      }),
      async execute({ scope }) {
        const payload = {
          facts: retrieved.facts,
          procedures: retrieved.procedures,
          episodes: retrieved.episodes,
        };

        const output = scope === 'all' ? payload : payload[scope];
        pushTrace(traceCollector, 'memory_report', output);
        return output;
      },
    });

    const semanticMemoryLookup = tool({
      name: 'semantic_memory_lookup',
      description: 'Inspect consolidated semantic memory stored outside the model weights.',
      parameters: z.object({
        query: z.string().describe('Search query for semantic memory inspection.'),
      }),
      async execute({ query }) {
        const inspected = await memoryManager.inspect();
        const matches = inspected.semanticMemory.filter((entry) =>
          `${entry.summary} ${entry.sourceEpisodeId ?? ''}`.toLowerCase().includes(query.toLowerCase())
        );
        pushTrace(traceCollector, 'semantic_memory_lookup', matches);
        return matches;
      },
    });

    return {
      availableTools: ['web_search', 'calculator', 'memory_report', 'semantic_memory_lookup'],
      tools: [
        webSearchTool({ searchContextSize: 'medium' }),
        calculator,
        memoryReport,
        semanticMemoryLookup,
      ],
    };
  },
});
