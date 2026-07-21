const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['tests/{unit,api}/**/*.test.js'],
    globals: true,
    setupFiles: ['tests/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.js', 'middleware/**/*.js'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
