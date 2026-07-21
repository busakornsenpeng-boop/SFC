const fs = require('fs');
const path = require('path');

const checks = [
  { file: 'middleware/adminAuth.js', forbidden: 'sfc-secret-key-change-this', message: 'Hard-coded JWT fallback detected.' },
  { file: 'middleware/adminAuth.js', forbidden: "|| 'sfc@2025'", message: 'Hard-coded admin password fallback detected.' },
  { file: 'server.js', forbidden: "app.get('/api/test-line-notify'", message: 'Unprotected LINE test endpoint detected.' },
];

const failures = checks.filter(check => fs.readFileSync(path.join(__dirname, '..', check.file), 'utf8').includes(check.forbidden));
if (failures.length) {
  failures.forEach(failure => console.error(`SECURITY: ${failure.message}`));
  process.exit(1);
}
console.log('Static security checks passed.');
