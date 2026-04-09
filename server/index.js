import express from 'express';
import cors from 'cors';
import { createFileStore } from './lib/fileStore.js';
import { createPlanner } from './runtime/planner.js';
import { createMemoryManager } from './runtime/memoryManager.js';
import { createToolRouter } from './runtime/toolRouter.js';
import { createModelAdapter } from './runtime/modelAdapter.js';
import { createEvaluator } from './runtime/evaluator.js';
import { createConsolidator } from './runtime/consolidator.js';
import { createAgentController } from './runtime/agentController.js';
import { createSessionManager } from './runtime/sessionManager.js';

const app = express();
const port = process.env.PORT || 3001;

const store = createFileStore();
const planner = createPlanner();
const memoryManager = createMemoryManager({ store });
const toolRouter = createToolRouter({ memoryManager });
const modelAdapter = createModelAdapter({ toolRouter });
const evaluator = createEvaluator();
const consolidator = createConsolidator({ memoryManager });
const sessionManager = createSessionManager({ store });
const agentController = createAgentController({
  planner,
  memoryManager,
  modelAdapter,
  evaluator,
  consolidator,
  sessionManager,
});

app.use(cors());
app.use(express.json());

app.get('/api/health', (_request, response) => {
  response.json({
    status: 'ok',
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});

app.get('/api/memory', async (_request, response, next) => {
  try {
    response.json(await memoryManager.inspect());
  } catch (error) {
    next(error);
  }
});

app.post('/api/chat', async (request, response, next) => {
  try {
    const input = String(request.body?.input ?? '').trim();
    const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId : undefined;

    if (!input) {
      response.status(400).json({ error: 'input is required' });
      return;
    }

    response.json(await agentController.run({ input, sessionId }));
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  response.status(500).json({
    error: error.message || 'Unexpected server error',
  });
});

app.listen(port, () => {
  console.log(`AutoResearchAgent server listening on http://localhost:${port}`);
});
