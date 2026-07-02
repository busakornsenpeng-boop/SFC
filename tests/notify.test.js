const assert = require('assert');

process.env.ADMIN_LINE_IDS = 'u1, u2';
const notify = require('../routes/notify');

assert.deepStrictEqual(notify.getAdminLineIds(), ['u1', 'u2']);

process.env.ADMIN_LINE_IDS = 'u3, ,u4';
assert.deepStrictEqual(notify.getAdminLineIds(), ['u3', 'u4']);

console.log('notify env parsing test passed');
