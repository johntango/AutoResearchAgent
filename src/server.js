import dotenv from 'dotenv';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

dotenv.config();

const port = Number.parseInt(process.env.PORT || '3001', 10);
const app = createApp();

app.listen(port, () => {
  logger.info('server.start', { port });
});
