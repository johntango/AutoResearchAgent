import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSystemController } from './controllers/systemController.js';
import { createWorkflowController } from './controllers/workflowController.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { createHealthRoutes } from './routes/healthRoutes.js';
import { createSystemRoutes } from './routes/systemRoutes.js';
import { createWorkflowRoutes } from './routes/workflowRoutes.js';
import { createSupervisor } from './services/supervisor.js';
import { stateStore } from './services/stateStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputRoot = path.join(__dirname, 'output');
const publicRoot = path.join(__dirname, 'public');

export const createApp = () => {
  const app = express();
  const supervisor = createSupervisor({ store: stateStore, outputRoot });
  const workflowController = createWorkflowController({ supervisor, store: stateStore });
  const systemController = createSystemController();

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(publicRoot));

  app.get('/favicon.ico', (_req, res) => {
    res.status(204).end();
  });

  app.use('/api/health', createHealthRoutes());
  app.use('/api/system', createSystemRoutes(systemController));
  app.use('/api/workflows', createWorkflowRoutes(workflowController));
  app.use(notFound);
  app.use(errorHandler);

  return app;
};
