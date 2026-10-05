const assert = require('node:assert/strict');
const { assistantText, extractArduinoCode, mergeCodeContinuation } = require('../dist/aiResponse');

assert.equal(assistantText({ message: { content: [{ type: 'text', text: 'OK' }] } }), 'OK');
assert.match(extractArduinoCode('{"code":"#include <Arduino.h>\\nvoid setup(){}\\nvoid loop(){}"}'), /void setup/);
assert.match(extractArduinoCode('```cpp\nvoid setup() {}\nvoid loop() {}\n```'), /void loop/);
assert.match(extractArduinoCode('说明如下：\nvoid setup() {}\nvoid loop() {}'), /void setup/);
assert.equal(extractArduinoCode('{"code":"void setup(){}"}'), '');
assert.equal(mergeCodeContinuation('abc shared-tail', 'shared-tail xyz'), 'abc shared-tail xyz');
assert.match(extractArduinoCode(mergeCodeContinuation('#include <Arduino.h>\nvoid setup(){}\nvoid lo', 'op(){}')), /void loop/);

console.log('aiResponse tests passed');
