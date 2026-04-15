import { Router } from 'express';
import multer from 'multer';

export const createWorkflowRoutes = (workflowController) => {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage() });

  router.get('/', workflowController.listWorkflows);
  router.post('/run', upload.fields([
    { name: 'targetFile', maxCount: 1 },
    { name: 'submittedFile', maxCount: 1 },
  ]), workflowController.runWorkflow);
  router.get('/:runId/output', workflowController.downloadOutput);
  router.get('/:runId', workflowController.getWorkflow);
  router.get('/:runId/trace', workflowController.getTrace);

  return router;
};
