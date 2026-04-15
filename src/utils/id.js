import crypto from 'node:crypto';

export const createRunId = () => `run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
