function stamp() {
  return new Date().toISOString();
}

export const logger = {
  info(message, meta = {}) {
    console.log(JSON.stringify({ level: 'info', time: stamp(), message, ...meta }));
  },
  warn(message, meta = {}) {
    console.warn(JSON.stringify({ level: 'warn', time: stamp(), message, ...meta }));
  },
  error(message, meta = {}) {
    console.error(JSON.stringify({ level: 'error', time: stamp(), message, ...meta }));
  }
};
