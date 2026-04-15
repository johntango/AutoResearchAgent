import { getRecentLogs } from '../utils/logger.js';

export const createSystemController = () => ({
  getLogs: (req, res, next) => {
    try {
      const limit = Number.parseInt(req.query.limit || '100', 10);
      res.json({ logs: getRecentLogs(limit) });
    } catch (error) {
      next(error);
    }
  },
});
