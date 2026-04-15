import { Router } from 'express';

export const createSystemRoutes = (systemController) => {
  const router = Router();

  router.get('/logs', systemController.getLogs);

  return router;
};
