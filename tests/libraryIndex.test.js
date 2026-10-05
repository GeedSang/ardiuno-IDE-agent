const assert = require('node:assert/strict');
const { extractExternalHeaders, parseInstalledLibraries, parseLibraryCandidates, chooseLibraryForHeader, chooseLibraryByNameSimilarity } = require('../dist/libraryIndex');

assert.deepEqual(extractExternalHeaders('#include <Wire.h>\n#include <Fancy_Sensor.h>\n#include "Fancy_Sensor.h"'), ['Fancy_Sensor.h']);
const candidates = parseLibraryCandidates(JSON.stringify({ libraries: [
  { name: 'Wrong ESP Library', latest: { provides_includes: ['Fancy_Sensor.h'], architectures: ['esp32'] } },
  { name: 'Fancy Sensor', latest: { provides_includes: ['Fancy_Sensor.h'], architectures: ['*'], license: 'MIT', website: 'https://example.test/fancy' } }
] }));
assert.equal(candidates[1].license, 'MIT');
assert.equal(candidates[1].website, 'https://example.test/fancy');
assert.deepEqual(parseInstalledLibraries(JSON.stringify({ installed_libraries: [{ library: { name: 'Fancy Sensor', version: '1.2.3', license: 'MIT', website: 'https://example.test/fancy', install_dir: 'C:\\private' } }] })), [{ name: 'Fancy Sensor', version: '1.2.3', license: 'MIT', website: 'https://example.test/fancy' }]);
assert.equal(parseInstalledLibraries(JSON.stringify({ installed_libraries: [{ library: { name: 'Unknown License', version: '1.0.0', license: 'Unspecified' } }] }))[0].license, '许可证未声明');
assert.equal(chooseLibraryForHeader('Fancy_Sensor.h', candidates, 'arduino:avr:uno'), 'Fancy Sensor');
assert.equal(chooseLibraryForHeader('MadeUp.h', candidates, 'arduino:avr:uno'), undefined);
assert.equal(chooseLibraryForHeader('SD.h', [{ name: 'SD', headers: [], architectures: ['*'] }], 'arduino:avr:uno'), 'SD');
assert.equal(chooseLibraryByNameSimilarity('Adafruit_BMP085_U.h', [
  { name: 'Adafruit BMP085 Library', headers: [], architectures: ['*'] },
  { name: 'Adafruit BMP085 Unified', headers: [], architectures: ['*'] }
], 'arduino:avr:uno'), 'Adafruit BMP085 Unified');
console.log('library index tests passed');
