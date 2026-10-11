// Kept apart from vite.config.ts: the client logic under test needs neither
// React nor Tailwind, and should not load them to run.
export default {
  test: { include: ['test/**/*.test.ts'] },
};
