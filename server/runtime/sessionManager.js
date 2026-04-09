import crypto from 'node:crypto';

const sessionFile = 'sessions.json';

export const createSessionManager = ({ store }) => ({
  async getSession(sessionId) {
    const sessions = await store.readJson(sessionFile, {});
    const id = sessionId && sessions[sessionId] ? sessionId : crypto.randomUUID();

    return {
      id,
      previousResponseId: sessions[id]?.previousResponseId || null,
    };
  },

  async saveSession({ sessionId, previousResponseId }) {
    const sessions = await store.readJson(sessionFile, {});
    sessions[sessionId] = {
      previousResponseId: previousResponseId || null,
      updatedAt: new Date().toISOString(),
    };
    await store.writeJson(sessionFile, sessions);
    return sessions[sessionId];
  },
});