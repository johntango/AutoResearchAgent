const MAX_LOG_ENTRIES = 300;
const recentLogs = [];

const writeLog = (level, event, meta = {}) => {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...meta,
  };

  recentLogs.push(entry);
  if (recentLogs.length > MAX_LOG_ENTRIES) {
    recentLogs.splice(0, recentLogs.length - MAX_LOG_ENTRIES);
  }

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
};

export const logger = {
  info: (event, meta) => writeLog('info', event, meta),
  warn: (event, meta) => writeLog('warn', event, meta),
  error: (event, meta) => writeLog('error', event, meta),
  debug: (event, meta) => writeLog('debug', event, meta),
};

export const getRecentLogs = (limit = 100) => recentLogs.slice(-Math.max(1, limit));
