const security = require('eslint-plugin-security');

module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**', 'public/**'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { console: 'readonly', process: 'readonly', module: 'readonly', require: 'readonly', __dirname: 'readonly', URLSearchParams: 'readonly' },
    },
    plugins: { security },
    rules: {
      ...security.configs.recommended.rules,
      'security/detect-object-injection': 'off',
      // Username routing is not a credential comparison; passwords use bcrypt below.
      'security/detect-possible-timing-attacks': 'off',
    },
  },
];
