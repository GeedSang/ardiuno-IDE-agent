const assert = require('node:assert/strict');
const { hardwareCapabilities, evaluateCapabilityConstraints } = require('../dist/hardwareCapabilities');
const { normalizeProjectSpec } = require('../dist/workflow');
assert.ok(hardwareCapabilities.length >= 10);
assert.equal(new Set(hardwareCapabilities.map(item => item.id)).size, hardwareCapabilities.length);
const fallback = { goal: '门禁', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] };
const rc522 = normalizeProjectSpec({
  components: [{ id: 'rfid', name: 'RC522', role: 'input', voltage: '3.3V' }],
  connections: ['SCK', 'MOSI', 'MISO', 'SS', 'RST'].map((pin, index) => ({ componentId: 'rfid', componentName: 'RC522', sourcePin: pin, target: 'Arduino', targetPin: `D${index + 8}` })).concat([{ componentId: 'rfid', componentName: 'RC522', sourcePin: 'VCC', target: 'Arduino', targetPin: '5V' }])
}, fallback);
assert.ok(evaluateCapabilityConstraints(rc522).some(issue => /不能直接把 VCC 接到 5V/.test(issue)));
rc522.connections.find(item => item.sourcePin === 'VCC').targetPin = '3.3V';
assert.deepEqual(evaluateCapabilityConstraints(rc522), []);
rc522.connections = rc522.connections.filter(item => item.sourcePin !== 'MISO');
assert.ok(evaluateCapabilityConstraints(rc522).some(issue => /缺少 MISO/.test(issue)));
const collision = normalizeProjectSpec({ components: [{ id: 'a', name: 'TCS34725', role: 'input' }, { id: 'b', name: 'TCS34725', role: 'input' }], connections: ['a', 'b'].flatMap(id => ['SDA', 'SCL'].map((pin, index) => ({ componentId: id, componentName: 'TCS34725', sourcePin: pin, target: 'Arduino', targetPin: index ? 'A5' : 'A4' }))) }, fallback);
assert.ok(evaluateCapabilityConstraints(collision).some(issue => /固定 I2C 地址 0x29/.test(issue)));
const wsSupportParts = normalizeProjectSpec({
  components: [
    { id: 'r', name: 'WS2812数据串联电阻', model: '220Ω', role: 'other' },
    { id: 'c', name: 'WS2812电源端缓冲电容', model: '1000uF', role: 'other' },
    { id: 'p', name: 'WS2812独立5V电源', role: 'power' }
  ], connections: []
}, fallback);
assert.deepEqual(evaluateCapabilityConstraints(wsSupportParts), [], 'support parts named after WS2812 must not require a DIN signal');

const shiftedRfid = normalizeProjectSpec({
  board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V' },
  components: [
    { id: 'rfid', name: 'RC522 RFID模块', role: 'input', voltage: '3.3V' },
    { id: 'llc', name: '逻辑电平转换模块', role: 'other', interface: 'SPI信号降压' }
  ],
  connections: [
    ...[['SCK','LV1'],['MOSI','LV2'],['SS','LV3'],['RST','LV4']].map(([sourcePin,targetPin]) => ({ componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin, target: '逻辑电平转换模块', targetPin })),
    { componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin: 'MISO', target: 'Arduino Uno', targetPin: 'MISO' },
    { componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin: 'VCC', target: 'Arduino Uno', targetPin: '3.3V' },
    { componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin: 'GND', target: 'Arduino Uno', targetPin: 'GND' },
    ...[['HV1','D13'],['HV2','D11'],['HV3','D10'],['HV4','D9']].map(([sourcePin,targetPin]) => ({ componentId: 'llc', componentName: '逻辑电平转换模块', sourcePin, target: 'Arduino Uno', targetPin }))
  ]
}, fallback);
assert.deepEqual(evaluateCapabilityConstraints(shiftedRfid), [], 'a complete RC522 level-shifter chain must be accepted without direct duplicate signals');
const partialShift = JSON.parse(JSON.stringify(shiftedRfid));
partialShift.connections = partialShift.connections.filter(item => !(item.componentId === 'rfid' && item.sourcePin === 'SCK'));
partialShift.connections.push({ componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin: 'SCK', target: 'Arduino Uno', targetPin: 'SCK', required: true, confirmed: false });
assert.ok(evaluateCapabilityConstraints(partialShift).some(issue => /SCK 必须完整经过/.test(issue)), 'partial RC522 level shifting must be rejected');
console.log('model-specific capability constraints tests passed');
