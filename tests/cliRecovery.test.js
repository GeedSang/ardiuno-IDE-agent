const assert = require('assert');
const { coreIdFromFqbn, missingPlatformFromLog } = require('../dist/cliRecovery');

assert.equal(coreIdFromFqbn('arduino:samd:mkrzero'), 'arduino:samd');
assert.equal(coreIdFromFqbn('arduino:avr:uno'), 'arduino:avr');
assert.equal(coreIdFromFqbn('bad'), undefined);
assert.equal(missingPlatformFromLog("Error during build: Platform 'arduino:samd' not found: platform not installed"), 'arduino:samd');
assert.equal(missingPlatformFromLog('ordinary compiler error'), undefined);
console.log('cliRecovery tests passed');
