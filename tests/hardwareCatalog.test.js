const assert = require('node:assert/strict');
const { hardwareKnowledgeFor, supportedHardwareSummary, evaluateSpecHardware, evaluateHardwareCode, normalizeBoardPinSyntax, resolveHardwareConnections } = require('../dist/hardwareCatalog');
const { evaluateProjectSpec, evaluateCodeAgainstSpec } = require('../dist/workflow');

const knowledge = hardwareKnowledgeFor('DS18B20、DHT22、TDS、舵机和MAX7219');
assert.match(knowledge, /OneWire/);
assert.match(knowledge, /DHT\.h/);
assert.match(knowledge, /MD_MAX72XX/);
assert.match(supportedHardwareSummary(), /Arduino Uno\/Nano\/Mega/);
assert.match(supportedHardwareSummary(), /矩阵键盘/);

assert.deepEqual(evaluateSpecHardware({
  components: [{ id: 'ds', name: 'DS18B20', role: 'input', interface: 'I2C', quantity: 1 }]
}), ['DS18B20 被错误标为 I2C，正确接口是 OneWire']);

const codeIssues = evaluateHardwareCode('TDS传感器和舵机', `
#include <Adafruit_DHT.h>
float readTDS(){ return 500.0; }
void setup(){} void loop(){ digitalWrite(9, 90); }
`);
assert.ok(codeIssues.some(issue => issue.includes('Adafruit_DHT')));
assert.ok(codeIssues.some(issue => issue.includes('Servo')));
assert.ok(codeIssues.some(issue => issue.includes('固定常数')));

const fakePhysicalChecks = evaluateHardwareCode('自动浇水', `
const bool PROJECT_CONN_PUMP_PLUS_TO_PSU_PLUS = true;
const bool PROJECT_PSU_RATED_AT_OR_ABOVE_PUMP_STALL_CURRENT = true;
bool runtimeDriverTopologyVerificationAvailable() { return PROJECT_CONN_PUMP_PLUS_TO_PSU_PLUS; }
`);
assert.ok(fakePhysicalChecks.some(issue => issue.includes('固定 true') && issue.includes('实物接线')));
assert.ok(fakePhysicalChecks.some(issue => issue.includes('STALL_CURRENT')));
assert.deepEqual(evaluateHardwareCode('继电器控制', 'const bool RELAY_ACTIVE_LOW = true;'), []);
assert.deepEqual(evaluateHardwareCode('水泵控制', 'bool pumpOn = true;'), []);

for (const resistorName of ['MOSFET栅极串联电阻', 'MOSFET栅极下拉电阻']) {
  const resistor = resolveHardwareConnections({
    version: 1, goal: '功率负载驱动', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
    components: [{ id: 'r', name: resistorName, model: '10kΩ', role: 'other', quantity: 1 }],
    connections: [
      { componentId: 'r', componentName: resistorName, sourcePin: '1', target: 'Arduino Uno', targetPin: 'GND' },
      { componentId: 'r', componentName: resistorName, sourcePin: '2', target: 'IRLZ44N MOSFET', targetPin: 'G' }
    ], libraries: [], behaviors: [], acceptance: [], risks: []
  });
  assert.deepEqual(resistor.unresolved, [], `${resistorName} is a two-terminal resistor, not a bare MOSFET`);
}

const incomingMosfetGate = resolveHardwareConnections({
  version: 1, goal: 'MOSFET驱动', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'gate', name: '栅极电阻', role: 'other', quantity: 1 },
    { id: 'fet', name: '逻辑电平N沟道MOSFET', model: 'IRLZ44N', role: 'other', quantity: 1 }
  ],
  connections: [
    { componentId: 'gate', componentName: '栅极电阻', sourcePin: '1', target: 'Arduino Uno', targetPin: 'D5' },
    { componentId: 'gate', componentName: '栅极电阻', sourcePin: '2', target: '逻辑电平N沟道MOSFET', targetPin: 'G' },
    { componentId: 'fet', componentName: '逻辑电平N沟道MOSFET', sourcePin: 'D', target: '水泵', targetPin: '-' },
    { componentId: 'fet', componentName: '逻辑电平N沟道MOSFET', sourcePin: 'S', target: 'Arduino Uno', targetPin: 'GND' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'access', description: '授权开门', evidence: 'user', passed: false }], risks: []
});
assert.ok(!incomingMosfetGate.unresolved.some(issue => issue.includes('G、D、S')), 'MOSFET gate reached through a series resistor is a valid G terminal connection');

const lowSideMosfetStage = resolveHardwareConnections({
  version: 1, goal: 'PWM经MOSFET控制12V两线负载', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'load', name: '12V单色两线LED灯带', role: 'output', interface: '两线电源负载', voltage: '12V', quantity: 1 },
    { id: 'psu', name: '12V外部电源', role: 'power', voltage: '12V', quantity: 1 },
    { id: 'fet', name: '逻辑电平N沟道MOSFET', model: 'IRLZ44N', role: 'other', quantity: 1 },
    { id: 'series', name: '栅极串联电阻', model: '220Ω', role: 'other', quantity: 1 },
    { id: 'pull', name: '栅极下拉电阻', model: '100kΩ', role: 'other', quantity: 1 }
  ], connections: [
    { componentId: 'load', componentName: '12V单色两线LED灯带', sourcePin: '-', target: '逻辑电平N沟道MOSFET', targetPin: 'D' },
    { componentId: 'series', componentName: '栅极串联电阻', sourcePin: '2', target: '逻辑电平N沟道MOSFET', targetPin: 'G' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'dim', description: 'PWM调光', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(lowSideMosfetStage.unresolved, [], 'a selected low-side MOSFET stage must be completed as a circuit contract');
assert.deepEqual(evaluateProjectSpec(lowSideMosfetStage.spec), [], 'the completed MOSFET power stage must pass project audit');
for (const pin of ['G', 'D', 'S']) assert.ok(lowSideMosfetStage.spec.connections.some(item => (item.componentId === 'fet' && item.sourcePin === pin) || (item.target === '逻辑电平N沟道MOSFET' && item.targetPin === pin)), `MOSFET topology must expose ${pin}`);
assert.equal(lowSideMosfetStage.spec.connections.filter(item => item.componentId === 'series').length, 2);
assert.equal(lowSideMosfetStage.spec.connections.filter(item => item.componentId === 'pull').length, 2);

const dualLowSideStages = resolveHardwareConnections({
  version: 1, goal: '加热片和风扇分别由两个MOSFET控制', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'heater', name: '加热片', role: 'output', voltage: '12V', quantity: 1 }, { id: 'fan', name: '风扇', role: 'output', voltage: '12V', quantity: 1 },
    { id: 'hm', name: '加热片N沟道MOSFET', model: 'MOSFET G/D/S', role: 'other', quantity: 1 }, { id: 'fm', name: '风扇N沟道MOSFET', model: 'MOSFET G/D/S', role: 'other', quantity: 1 },
    { id: 'hgr', name: '加热片栅极串联电阻', role: 'other', quantity: 1 }, { id: 'fgr', name: '风扇栅极串联电阻', role: 'other', quantity: 1 },
    { id: 'hpd', name: '加热片栅极下拉电阻', role: 'other', quantity: 1 }, { id: 'fpd', name: '风扇栅极下拉电阻', role: 'other', quantity: 1 },
    { id: 'psu', name: '12V电源', role: 'power', voltage: '12V', quantity: 1 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '独立控制', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(dualLowSideStages.unresolved, [], 'multiple MOSFET channels must normalize independently');
assert.deepEqual(evaluateProjectSpec(dualLowSideStages.spec), [], 'multiple power channels must pass project audit');
for (const id of ['hgr', 'fgr', 'hpd', 'fpd']) assert.equal(dualLowSideStages.spec.connections.filter(item => item.componentId === id).length, 2, `${id} needs both terminals`);
assert.ok(dualLowSideStages.spec.connections.some(item => item.componentId === 'fan' && item.target === '风扇N沟道MOSFET'));
assert.ok(dualLowSideStages.spec.connections.some(item => item.componentId === 'heater' && item.target === '加热片N沟道MOSFET'));

const mkrPn532 = resolveHardwareConnections({
  version: 1, goal: 'PN532 I2C门锁', board: { name: 'Arduino MKR Zero', fqbn: 'arduino:samd:mkrzero', voltage: '3.3V', confirmed: false },
  components: [{ id: 'pn532', name: 'PN532 NFC模块', role: 'input', interface: 'I2C', voltage: '3.3V', quantity: 1 }],
  connections: [{ componentId: 'pn532', componentName: 'PN532 NFC模块', sourcePin: 'VCC', target: 'Arduino MKR Zero', targetPin: '3V3', voltage: '3.3V' }],
  libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '读卡', evidence: 'user', passed: false }], risks: []
});
assert.ok(!evaluateProjectSpec(mkrPn532.spec).some(issue => issue.includes('不是有效供电端')), '3V3 is a standard 3.3V board power pin');

const passiveKeypad = resolveHardwareConnections({
  version: 1, goal: '4x4矩阵键盘输入密码', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'kbd', name: '4x4薄膜矩阵键盘', model: 'passive matrix keypad', role: 'input', interface: '行列矩阵数字输入', voltage: '无源触点', quantity: 1 }],
  connections: [], libraries: ['Keypad'], behaviors: [], acceptance: [{ id: 'key', description: '读取按键', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(passiveKeypad.unresolved, []);
assert.deepEqual(evaluateProjectSpec(passiveKeypad.spec), []);
assert.equal(passiveKeypad.spec.connections.filter(item => item.componentId === 'kbd').length, 8);
assert.ok(!passiveKeypad.spec.connections.some(item => item.componentId === 'kbd' && /VCC|GND/.test(item.sourcePin)));

const driverOwnedMotorWires = resolveHardwareConnections({
  version: 1, goal: '驱动直流电机', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'driver', name: 'L298N电机驱动器', role: 'output', quantity: 1 },
    { id: 'motor', name: '左直流电机', role: 'output', voltage: '6V', quantity: 1 }
  ],
  connections: [
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'OUT1', target: '左直流电机', targetPin: '+' },
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'OUT2', target: '左直流电机', targetPin: '-' }
  ], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.ok(!driverOwnedMotorWires.unresolved.some(issue => issue.includes('左直流电机')), 'motor wires owned by the driver still prove the motor has + and - topology');

const trackerHardware = resolveHardwareConnections({
  version: 1, goal: '两个光敏传感器控制舵机追光', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'left', name: '左光敏传感器模块', role: 'input', voltage: '5V', quantity: 1 },
    { id: 'right', name: '右光敏传感器模块', role: 'input', voltage: '5V', quantity: 1 },
    { id: 'servo', name: '舵机', model: 'SG90', role: 'output', voltage: '5V', quantity: 1 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '舵机追光', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(trackerHardware.unresolved, [], 'sun tracker hardware must normalize without missing servo power');
assert.ok(trackerHardware.spec.connections.some(item => item.componentId === 'servo' && item.sourcePin === 'SIG' && item.targetPin === 'D9'), 'unspecified Uno servo signal should use the stable D9 convention');
assert.ok(trackerHardware.spec.connections.some(item => item.componentId === 'servo' && item.sourcePin === 'VCC'));
assert.ok(trackerHardware.spec.connections.some(item => item.componentId === 'servo' && item.sourcePin === 'GND'));

const passiveDividerHardware = resolveHardwareConnections({
  version: 1, goal: '两只光敏电阻分压控制舵机追光', board: { name: 'Arduino Uno R3', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'ldrL', name: '左光敏电阻', model: 'GL5528/LDR', role: 'input', interface: '模拟分压', voltage: '5V', quantity: 1 },
    { id: 'ldrR', name: '右光敏电阻', model: 'GL5528/LDR', role: 'input', interface: '模拟分压', voltage: '5V', quantity: 1 },
    { id: 'rL', name: '左分压电阻', model: '10kΩ', role: 'other', quantity: 1 },
    { id: 'rR', name: '右分压电阻', model: '10kΩ', role: 'other', quantity: 1 },
    { id: 'servo', name: '舵机', model: 'SG90', role: 'output', voltage: '5V', quantity: 1 }
  ], connections: [
    { componentId: 'ldrL', componentName: '左光敏电阻', sourcePin: '端2', target: '左分压电阻', targetPin: '端1/L_SIG' },
    { componentId: 'ldrL', componentName: '左光敏电阻', sourcePin: '端1/L_SIG', target: 'Arduino Uno R3', targetPin: 'A0' },
    { componentId: 'ldrL', componentName: '左光敏电阻', sourcePin: '端2', target: 'Arduino Uno R3', targetPin: 'GND' },
    { componentId: 'ldrR', componentName: '右光敏电阻', sourcePin: '端2', target: '右分压电阻', targetPin: '端1/R_SIG' },
    { componentId: 'ldrR', componentName: '右光敏电阻', sourcePin: '端1/R_SIG', target: 'Arduino Uno R3', targetPin: 'A1' }
  ], libraries: ['Servo'], behaviors: [], acceptance: [{ id: 'track', description: '舵机追光', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(passiveDividerHardware.unresolved, [], 'bare resistive sensors must be rebuilt as complete voltage dividers');
assert.deepEqual(evaluateProjectSpec(passiveDividerHardware.spec), [], 'normalized voltage dividers must pass project audit');
for (const [sensor, resistor, analog] of [['ldrL','rL','A0'], ['ldrR','rR','A1']]) {
  assert.ok(passiveDividerHardware.spec.connections.some(item => item.componentId === sensor && item.sourcePin === '1' && item.targetPin === '5V'));
  assert.ok(passiveDividerHardware.spec.connections.some(item => item.componentId === sensor && item.sourcePin === '2' && item.componentName && item.targetPin === '1'));
  assert.ok(passiveDividerHardware.spec.connections.some(item => item.componentId === resistor && item.sourcePin === '1' && item.targetPin === analog));
  assert.ok(passiveDividerHardware.spec.connections.some(item => item.componentId === resistor && item.sourcePin === '2' && item.targetPin === 'GND'));
}

const accessHardware = resolveHardwareConnections({
  version: 1, goal: 'RC522刷卡后舵机开门，未授权亮红色LED', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'rfid', name: 'RC522 RFID', role: 'input', voltage: '3.3V', quantity: 1 },
    { id: 'servo', name: '舵机', role: 'output', voltage: '5V', quantity: 1 },
    { id: 'led', name: '红色裸LED', role: 'output', voltage: '2V', quantity: 1 },
    { id: 'resistor', name: 'LED限流电阻', role: 'other', quantity: 1 }
  ], connections: [
    { componentId: 'resistor', componentName: 'LED限流电阻', sourcePin: '1', target: 'Arduino Uno', targetPin: 'D4' },
    { componentId: 'resistor', componentName: 'LED限流电阻', sourcePin: '2', target: '红色裸LED', targetPin: 'A' },
    { componentId: 'led', componentName: '红色裸LED', sourcePin: 'K', target: 'Arduino Uno', targetPin: 'GND' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '门禁动作', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(accessHardware.unresolved, [], 'access control discrete LED and servo wiring must normalize without false missing-power errors');
assert.ok(!evaluateProjectSpec(accessHardware.spec).some(issue => /舵机 缺少电源|红色裸LED 缺少电源/.test(issue)));

const lineFollowerHardware = resolveHardwareConnections({
  version: 1, goal: '两个循迹传感器和L298N控制两台直流电机', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'driver', name: '双路电机驱动器', model: 'L298N', role: 'controller', voltage: '12V', quantity: 1 },
    { id: 'leftMotor', name: '左直流电机', role: 'output', voltage: '6V', quantity: 1 },
    { id: 'rightMotor', name: '右直流电机', role: 'output', voltage: '6V', quantity: 1 }
  ], connections: [
    { componentId: 'driver', componentName: '双路电机驱动器', sourcePin: 'OUT1', target: '左直流电机', targetPin: '+' },
    { componentId: 'driver', componentName: '双路电机驱动器', sourcePin: 'OUT2', target: '左直流电机', targetPin: '-' },
    { componentId: 'driver', componentName: '双路电机驱动器', sourcePin: 'OUT3', target: '右直流电机', targetPin: '+' },
    { componentId: 'driver', componentName: '双路电机驱动器', sourcePin: 'OUT4', target: '右直流电机', targetPin: '-' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '小车循迹', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(lineFollowerHardware.unresolved, [], 'an L298N marked controller is still a peripheral driver requiring normalized control terminals');
for (const pin of ['ENA', 'IN1', 'IN2', 'ENB', 'IN3', 'IN4', 'OUT1', 'OUT2', 'OUT3', 'OUT4']) assert.ok(lineFollowerHardware.spec.connections.some(item => item.componentId === 'driver' && item.sourcePin === pin), `L298N must retain ${pin}`);
assert.ok(!evaluateProjectSpec(lineFollowerHardware.spec).some(issue => /直流电机 缺少/.test(issue)));

const safeAccessTopology = resolveHardwareConnections({
  version: 1, goal: 'RC522刷卡舵机开门', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'rfid', name: 'RC522 RFID模块', role: 'input', voltage: '3.3V', quantity: 1 },
    { id: 'llc', name: '逻辑电平转换模块', role: 'other', interface: 'SPI信号降压', quantity: 1 },
    { id: 'servo', name: '舵机', role: 'output', voltage: '独立5V', quantity: 1 },
    { id: 'button', name: '内部常开按钮', model: '常开按钮', role: 'input', quantity: 1 }
  ], connections: [
    ...[['SCK','LV1'],['MOSI','LV2'],['SS','LV3'],['RST','LV4']].map(([sourcePin,targetPin]) => ({ componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin, target: '逻辑电平转换模块', targetPin })),
    { componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin: 'MISO', target: 'Arduino Uno', targetPin: 'MISO' },
    ...[['HV1','D13'],['HV2','D11'],['HV3','D10'],['HV4','D9']].map(([sourcePin,targetPin]) => ({ componentId: 'llc', componentName: '逻辑电平转换模块', sourcePin, target: 'Arduino Uno', targetPin })),
    { componentId: 'servo', componentName: '舵机', sourcePin: '+5V', target: '舵机', targetPin: 'V+' },
    { componentId: 'servo', componentName: '舵机', sourcePin: 'GND', target: '舵机', targetPin: 'GND' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '门禁工作', evidence: 'user', passed: false }], risks: []
});
for (const signal of ['SCK','MOSI','SS','RST']) assert.ok(safeAccessTopology.spec.connections.some(item => item.componentId === 'rfid' && item.sourcePin === signal && item.target === '逻辑电平转换模块'), `${signal} must keep its indirect level-shifter path`);
assert.ok(!safeAccessTopology.spec.connections.some(item => item.componentId === 'rfid' && ['SCK','MOSI','SS','RST'].includes(item.sourcePin) && /Arduino/.test(item.target)), 'shifted RC522 outputs must not also be wired directly');
assert.ok(safeAccessTopology.spec.connections.some(item => item.componentId === 'servo' && item.sourcePin === 'VCC' && /独立/.test(item.target)), 'self-connected servo power must be replaced with a real external supply');
assert.ok(!safeAccessTopology.spec.connections.some(item => item.componentId === 'button' && item.sourcePin === 'VCC'), 'a passive normally-open button must not receive invented VCC');
assert.ok(safeAccessTopology.spec.connections.some(item => item.componentId === 'button' && /^(?:COM|NO)$/.test(item.sourcePin) && item.targetPin === 'GND'), 'a passive button needs a return path to GND');

const malformedAccessTopology = resolveHardwareConnections({
  version: 1, goal: 'RC522刷卡、舵机开门、按钮内部开门', board: { name: 'Arduino Uno Rev3', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'rfid', name: 'RC522 RFID模块', model: 'MFRC522 SPI 3.3V', role: 'input', voltage: '3.3V', quantity: 1 },
    { id: 'lv', name: 'RC522 SPI电平转换器', model: '8路双向MOSFET电平转换HV/LV', role: 'other', interface: 'SPI电平转换', voltage: '5V/3.3V', quantity: 1 },
    { id: 'btn', name: '内部开门按钮', model: '常开按钮', role: 'input', interface: '数字输入', voltage: '5V', quantity: 1 }
  ],
  connections: [
    ...[['SCK','SCK'],['MOSI','MOSI'],['MISO','MISO'],['SS','D3'],['RST','D4']].map(([sourcePin,targetPin]) => ({ componentId: 'rfid', componentName: 'RC522 RFID模块', sourcePin, target: 'Arduino Uno Rev3', targetPin })),
    { componentId: 'lv', componentName: 'RC522 SPI电平转换器', sourcePin: 'LV1', target: 'rfid', targetPin: 'SCK' },
    { componentId: 'lv', componentName: 'RC522 SPI电平转换器', sourcePin: 'HV3', target: 'board', targetPin: 'MISO' },
    { componentId: 'lv', componentName: 'RC522 SPI电平转换器', sourcePin: 'SCK', target: 'Arduino Uno Rev3', targetPin: 'SCK' },
    { componentId: 'btn', componentName: '内部开门按钮', sourcePin: 'SW', target: 'Arduino Uno Rev3', targetPin: 'D5' },
    { componentId: 'btn', componentName: '内部开门按钮', sourcePin: 'COM', target: 'Arduino Uno Rev3', targetPin: 'GND' },
    { componentId: 'btn', componentName: '内部开门按钮', sourcePin: '另一端', target: 'rbtn', targetPin: '一端' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'access', description: '授权开门', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(malformedAccessTopology.unresolved, [], 'partial level-shifter channels must be rebuilt into a complete interface contract');
assert.deepEqual(evaluateProjectSpec(malformedAccessTopology.spec), [], 'normalized access wiring must pass the full project audit');
for (let channel = 1; channel <= 5; channel++) {
  assert.ok(malformedAccessTopology.spec.connections.some(item => item.componentId === 'rfid' && item.targetPin === `LV${channel}`));
  assert.ok(malformedAccessTopology.spec.connections.some(item => item.componentId === 'lv' && item.sourcePin === `HV${channel}`));
}
for (const pin of ['HV', 'LV', 'GND']) assert.ok(malformedAccessTopology.spec.connections.some(item => item.componentId === 'lv' && item.sourcePin === pin), `level shifter needs ${pin} power wiring`);
assert.ok(!malformedAccessTopology.spec.connections.some(item => item.componentId === 'btn' && item.sourcePin === '另一端'), 'model-invented passive-button terminals must be removed');

const incompleteDiscreteParts = resolveHardwareConnections({
  version: 1, goal: '未授权亮红色LED，按钮开门', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'led', name: '红色LED', model: '裸LED A/K', role: 'output', voltage: '2V', quantity: 1 },
    { id: 'ledR', name: '红LED限流电阻', model: '220Ω', role: 'other', addedForSafety: true, quantity: 1 },
    { id: 'button', name: '内部常开按钮', model: '常开按钮', role: 'input', quantity: 1 },
    { id: 'buttonR', name: '按钮下拉电阻', model: '10kΩ', role: 'other', addedForSafety: true, quantity: 1 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: 'LED与按钮工作', evidence: 'user', passed: false }], risks: []
});
assert.deepEqual(incompleteDiscreteParts.unresolved, [], 'known bare LED and passive button topology should be completed deterministically');
assert.ok(!incompleteDiscreteParts.spec.components.some(item => item.id === 'buttonR'), 'an unconnected model-added button bias resistor is redundant with INPUT_PULLUP');
assert.equal(incompleteDiscreteParts.spec.connections.filter(item => item.componentId === 'ledR').length, 2, 'LED resistor must have exactly two endpoints');
assert.ok(incompleteDiscreteParts.spec.connections.some(item => item.componentId === 'led' && item.sourcePin === 'K' && item.targetPin === 'GND'));
assert.ok(incompleteDiscreteParts.spec.connections.some(item => item.componentId === 'ledR' && item.target === '红色LED' && item.targetPin === 'A'));
assert.match(normalizeBoardPinSyntax('#define LED D13\n#define SENSOR A0', 'arduino:avr:uno'), /LED 13/);
assert.match(normalizeBoardPinSyntax('#define LED D5', 'esp8266:esp8266:nodemcuv2'), /D5/);

const resolved = resolveHardwareConnections({
  version: 1, goal: '声音流水灯', board: { name: 'Arduino Mega', fqbn: 'arduino:avr:mega', voltage: '5V', confirmed: false },
  components: [{ id: 'mic', name: '声音传感器', role: 'input', quantity: 1 }, { id: 'strip', name: 'WS2812 灯带', role: 'output', quantity: 1 }],
  connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.deepEqual(resolved.unresolved, []);
assert.ok(resolved.spec.connections.some(item => item.componentId === 'mic' && item.sourcePin === 'AO' && item.targetPin === 'A0'));
assert.ok(resolved.spec.connections.some(item => item.componentId === 'strip' && item.sourcePin === 'DIN' && /^D\d+$/.test(item.targetPin)));
assert.ok(resolved.spec.connections.some(item => item.componentId === 'strip' && item.sourcePin === 'VCC' && item.target.includes('独立')));

const mixed = resolveHardwareConnections({
  version: 1, goal: '温湿度显示与距离报警', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'dht', name: 'DHT22', role: 'input', quantity: 1 },
    { id: 'sonar', name: 'HC-SR04', role: 'input', quantity: 1 },
    { id: 'oled', name: 'OLED SSD1306', role: 'output', quantity: 1 },
    { id: 'buzz', name: '有源蜂鸣器', role: 'output', quantity: 1 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.deepEqual(mixed.unresolved, []);
assert.equal(mixed.spec.connections.filter(item => item.targetPin === 'SDA').length, 1);
assert.equal(mixed.spec.connections.filter(item => item.componentId === 'sonar' && /TRIG|ECHO/.test(item.sourcePin)).length, 2);
const allocatedSignals = mixed.spec.connections.filter(item => /^D\d+$/.test(item.targetPin)).map(item => item.targetPin);
assert.equal(new Set(allocatedSignals).size, allocatedSignals.length);

const unknown = resolveHardwareConnections({
  version: 1, goal: '使用未知模块', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'mystery', name: 'XYZ-123模块', role: 'input', quantity: 1 }],
  connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.ok(unknown.unresolved.some(item => item.includes('缺少可验证的端子')));

const withJumperWires = resolveHardwareConnections({
  version: 1, goal: '按钮控制LED', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'button', name: '按钮模块', role: 'input', quantity: 1 },
    { id: 'wires', name: '杜邦连接线', role: 'other', quantity: 10 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.deepEqual(withJumperWires.unresolved, []);
assert.ok(!withJumperWires.spec.connections.some(item => item.componentId === 'wires'));

const withMechanicalAccessories = resolveHardwareConnections({
  version: 1, goal: '自动浇水', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'pump', name: '5V水泵驱动模块', role: 'output', interface: '数字输出', quantity: 1 },
    { id: 'case', name: '防水盒', role: 'other', interface: '机械防护', quantity: 1 },
    { id: 'panel', name: '隔水板', role: 'other', quantity: 1 },
    { id: 'tank', name: '储水箱', role: 'other', quantity: 1 },
    { id: 'tube', name: '硅胶水管', role: 'other', quantity: 1 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.deepEqual(withMechanicalAccessories.unresolved, []);
for (const id of ['case', 'panel', 'tank', 'tube']) assert.ok(!withMechanicalAccessories.spec.connections.some(item => item.componentId === id), `${id} must not receive wiring`);
assert.ok(withMechanicalAccessories.spec.connections.some(item => item.componentId === 'pump' && item.sourcePin === 'SIG'));

for (const alias of ['Sound Sensor', 'sound-sensor', 'Microphone Module', 'KY-038']) {
  const aliasResult = resolveHardwareConnections({
    version: 1, goal: '读取声音', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
    components: [{ id: 'sound', name: alias, role: 'input', quantity: 1 }], connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
  });
  assert.deepEqual(aliasResult.unresolved, [], `${alias} should resolve`);
  assert.ok(aliasResult.spec.connections.some(item => item.sourcePin === 'AO' && item.targetPin === 'A0'));
}

const protectedLoads = resolveHardwareConnections({
  version: 1, goal: '水泵和植物灯', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'pump', name: '5V微型潜水泵', role: 'output', voltage: '5V', quantity: 1 },
    { id: 'diode', name: '水泵续流二极管', model: '1N4007', role: 'other', quantity: 1 },
    { id: 'grow', name: '5V植物灯条', role: 'output', voltage: '5V', quantity: 1 },
    { id: 'gate', name: '灯栅极限流电阻', model: '220Ω', role: 'other', quantity: 1 },
    { id: 'pull', name: '灯栅极下拉电阻', model: '10kΩ', role: 'other', quantity: 1 },
    { id: 'mosfet', name: 'MOSFET驱动器', role: 'other', quantity: 1 }
  ],
  connections: [
    { componentId: 'pump', componentName: '5V微型潜水泵', sourcePin: '+', target: '5V电源', targetPin: '5V' },
    { componentId: 'pump', componentName: '5V微型潜水泵', sourcePin: '-', target: 'MOSFET驱动器', targetPin: 'D' },
    { componentId: 'diode', componentName: '水泵续流二极管', sourcePin: 'K', target: '5V微型潜水泵', targetPin: '+' },
    { componentId: 'diode', componentName: '水泵续流二极管', sourcePin: 'A', target: '5V微型潜水泵', targetPin: '-' },
    { componentId: 'grow', componentName: '5V植物灯条', sourcePin: '+', target: '5V电源', targetPin: '5V' },
    { componentId: 'grow', componentName: '5V植物灯条', sourcePin: '-', target: 'MOSFET驱动器', targetPin: 'D2' },
    { componentId: 'gate', componentName: '灯栅极限流电阻', sourcePin: '1', target: 'Arduino Uno', targetPin: 'D6' },
    { componentId: 'gate', componentName: '灯栅极限流电阻', sourcePin: '2', target: 'MOSFET驱动器', targetPin: 'G2' },
    { componentId: 'pull', componentName: '灯栅极下拉电阻', sourcePin: '1', target: 'MOSFET驱动器', targetPin: 'G2' },
    { componentId: 'pull', componentName: '灯栅极下拉电阻', sourcePin: '2', target: 'Arduino Uno', targetPin: 'GND' },
    { componentId: 'mosfet', componentName: 'MOSFET驱动器', sourcePin: 'S', target: 'Arduino Uno', targetPin: 'GND' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '负载受控', evidence: 'user' }], risks: []
});
assert.deepEqual(protectedLoads.unresolved, []);
for (const id of ['pump', 'diode', 'grow', 'gate', 'pull', 'mosfet']) assert.ok(protectedLoads.spec.connections.some(item => item.componentId === id), `${id} wiring must be preserved`);
assert.deepEqual(evaluateProjectSpec(protectedLoads.spec), []);
assert.deepEqual(evaluateCodeAgainstSpec('const int LIGHT_PIN = 6; void setup(){} void loop(){}', protectedLoads.spec), []);

const motorDriver = resolveHardwareConnections({
  version: 1, goal: 'L298N控制直流电机', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'driver', name: 'L298N电机驱动器', role: 'output', voltage: '12V', quantity: 1 },
    { id: 'motor', name: '直流电机', role: 'output', voltage: '12V', quantity: 1 }
  ],
  connections: [
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'ENA', target: 'Arduino Uno', targetPin: 'D5' },
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'IN1', target: 'Arduino Uno', targetPin: 'D7' },
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'IN2', target: 'Arduino Uno', targetPin: 'D8' },
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'OUT1', target: '直流电机', targetPin: '+' },
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'OUT2', target: '直流电机', targetPin: '-' },
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'VCC', target: '12V电源', targetPin: '12V' },
    { componentId: 'driver', componentName: 'L298N电机驱动器', sourcePin: 'GND', target: 'Arduino Uno与12V电源共地', targetPin: 'GND' },
    { componentId: 'motor', componentName: '直流电机', sourcePin: '+', target: 'L298N电机驱动器', targetPin: 'OUT1' },
    { componentId: 'motor', componentName: '直流电机', sourcePin: '-', target: 'L298N电机驱动器', targetPin: 'OUT2' }
  ], libraries: [], behaviors: [], acceptance: [{ id: 'm', description: '电机可调速正反转', evidence: 'user' }], risks: []
});
assert.deepEqual(motorDriver.unresolved, []);
assert.ok(motorDriver.spec.connections.some(item => item.componentId === 'driver' && item.sourcePin === 'OUT1'), 'driver output topology must survive auto pin allocation');
assert.deepEqual(evaluateProjectSpec(motorDriver.spec), []);

const incompleteProtection = resolveHardwareConnections({
  version: 1, goal: '二极管保护', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'd', name: '续流二极管', model: '1N4007', role: 'other', quantity: 1 }],
  connections: [{ componentId: 'd', componentName: '续流二极管', sourcePin: 'A', target: '水泵', targetPin: '-' }],
  libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.ok(incompleteProtection.unresolved.some(issue => issue.includes('A(阳极)') && issue.includes('K(阴极)')), 'incomplete protection wiring must remain blocked');

const duplicateEcho = resolveHardwareConnections({
  version: 1, goal: '超声波避障', board: { name: 'Arduino Nano', fqbn: 'arduino:avr:nano', voltage: '5V', confirmed: false },
  components: [{ id: 'sonar', name: 'HC-SR04', role: 'input', quantity: 1 }],
  connections: [
    { componentId: 'sonar', componentName: 'HC-SR04', sourcePin: 'TRIG', target: 'Arduino Nano', targetPin: 'D5' },
    { componentId: 'sonar', componentName: 'HC-SR04', sourcePin: 'ECHO', target: 'Arduino Nano', targetPin: 'D6' },
    { componentId: 'sonar', componentName: 'HC-SR04', sourcePin: 'ECHO', target: 'Arduino Nano', targetPin: 'A0' }
  ], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.equal(duplicateEcho.spec.connections.filter(item => item.componentId === 'sonar' && item.sourcePin === 'ECHO').length, 1, 'one HC-SR04 must keep exactly one ECHO');
const badCarCode = 'const int PIN_ECHO_D6=6; const int PIN_ECHO_A0=A0; void setup(){tone(11,1000);} void loop(){}';
const badCarIssues = evaluateCodeAgainstSpec(badCarCode, duplicateEcho.spec);
assert.ok(badCarIssues.some(issue => issue.includes('PIN_ECHO_A0') && issue.includes('接线表之外')));
assert.ok(badCarIssues.some(issue => issue.includes('D11') && issue.includes('接线表之外')));
const lockedCarGoal = `原始目标：循迹避障小车\n已确认硬件：Arduino Nano、HC-SR04+3路TCRT5000\n已确认硬件JSON：${JSON.stringify([
  { id: 'board', name: 'Arduino Nano V3', model: '', quantity: 1 },
  { id: 'sensors', name: 'HC-SR04+3路TCRT5000', model: '', quantity: 1 }
])}\n执行要求：HC-SR04负责避障`;
assert.match(lockedCarGoal, /已确认硬件JSON/, 'beginner flow must preserve a machine-readable inventory');

const vccNamedLoad = resolveHardwareConnections({
  version: 1, goal: '植物补光', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'grow', name: '5V植物灯条', role: 'output', voltage: '5V', quantity: 1 }],
  connections: [
    { componentId: 'grow', componentName: '5V植物灯条', sourcePin: 'VCC', target: '5V电源', targetPin: '5V' },
    { componentId: 'grow', componentName: '5V植物灯条', sourcePin: 'GND', target: 'MOSFET', targetPin: 'D' }
  ], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.ok(!vccNamedLoad.unresolved.some(issue => issue.includes('两线负载')), 'VCC/GND are valid names for a two-wire load');

const reservedPinSpec = resolveHardwareConnections({
  version: 1, goal: '保留既有引脚', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'custom', name: 'XYZ自定义输入模块', role: 'input', quantity: 1 },
    { id: 'button', name: '按钮模块', role: 'input', quantity: 1 }
  ],
  connections: [{ componentId: 'custom', componentName: 'XYZ自定义输入模块', sourcePin: 'SIG', target: 'Arduino Uno', targetPin: 'D2' }],
  libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.ok(reservedPinSpec.spec.connections.some(item => item.componentId === 'button' && item.sourcePin === 'SW' && item.targetPin !== 'D2'), 'automatic allocation must avoid a pin reserved by another component');

const resolveOne = (name, role = 'input', model = '') => resolveHardwareConnections({
  version: 1, goal: `测试${name}`, board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'part', name, model, role, quantity: 1 }], connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
const expectTerminals = (names, terminals, role = 'input') => {
  for (const name of names) {
    const result = resolveOne(name, role);
    assert.deepEqual(result.unresolved, [], `${name} should resolve without guessing unknown terminals`);
    for (const terminal of terminals) assert.ok(result.spec.connections.some(item => item.sourcePin === terminal), `${name} should expose ${terminal}`);
  }
};

expectTerminals(['BME280', 'BMP280', 'BH1750', 'MPU6050', 'DS3231 RTC'], ['SDA', 'SCL']);
expectTerminals(['HC-05蓝牙模块', 'NEO-6M GPS模块', 'AS608指纹模块'], ['TX', 'RX']);
expectTerminals(['RC522 RFID模块'], ['SCK', 'MOSI', 'MISO', 'SS', 'RST']);
expectTerminals(['Micro SD卡模块'], ['SCK', 'MOSI', 'MISO', 'CS']);
expectTerminals(['KY-040旋转编码器'], ['CLK', 'DT', 'SW']);
expectTerminals(['A4988步进电机驱动器', 'DRV8825步进驱动器'], ['STEP', 'DIR', 'EN'], 'output');
expectTerminals(['MQ-2气体传感器', '雨滴传感器', '水位传感器'], ['AO']);
expectTerminals(['HX711称重模块'], ['DT', 'SCK']);
expectTerminals(['MAX6675热电偶模块'], ['SCK', 'SO', 'CS']);
expectTerminals(['双轴摇杆模块'], ['VRX', 'VRY', 'SW']);

for (const [name, expectedCount] of [['4x4薄膜键盘', 8], ['3×4矩阵键盘', 7]]) {
  const result = resolveOne(name, 'input');
  assert.deepEqual(result.unresolved, [], `${name} should resolve as a passive row-column matrix`);
  const signals = result.spec.connections.filter(item => /^R\d+$|^C\d+$/.test(item.sourcePin));
  assert.equal(signals.length, expectedCount, `${name} should allocate rows plus columns`);
  assert.ok(!result.spec.connections.some(item => /^(?:VCC|GND)$/.test(item.sourcePin)), `${name} must not receive invented power pins`);
  assert.ok(result.spec.libraries.includes('Keypad'));
}

const rfidAndKeypad = resolveHardwareConnections({
  version: 1, goal: '刷卡密码锁', board: { name: 'Arduino Nano', fqbn: 'arduino:avr:nano', voltage: '5V', confirmed: false },
  components: [
    { id: 'rfid', name: 'RC522 RFID模块', role: 'input', quantity: 1 },
    { id: 'keys', name: '4x4薄膜键盘', role: 'input', quantity: 1 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.deepEqual(rfidAndKeypad.unresolved, []);
const keypadTargets = rfidAndKeypad.spec.connections.filter(item => item.componentId === 'keys').map(item => item.targetPin);
assert.ok(!keypadTargets.some(pin => ['D11', 'D12', 'D13'].includes(pin)), 'Nano keypad allocation must avoid physical SPI pins used by RC522');

for (const ambiguousName of ['RFID模块', 'LCD1602显示屏']) {
  const result = resolveOne(ambiguousName, 'input');
  assert.ok(result.unresolved.some(issue => issue.includes('缺少可验证的端子')), `${ambiguousName} must request an exact interface instead of inventing one`);
}
const explicitPn532 = resolveHardwareConnections({
  version: 1, goal: 'NFC读卡', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'nfc', name: 'PN532 NFC模块', role: 'input', interface: 'I2C', quantity: 1 }],
  connections: [], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.deepEqual(explicitPn532.unresolved, []);
assert.ok(explicitPn532.spec.connections.some(item => item.sourcePin === 'SDA'));

const inventedAlias = resolveHardwareConnections({
  version: 1, goal: '距离报警', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'buzz', name: '有源蜂鸣器', role: 'output', quantity: 1 }],
  connections: [
    { componentId: 'buzz', componentName: '有源蜂鸣器', sourcePin: 'SIG', target: 'Arduino Uno', targetPin: 'D8' },
    { componentId: 'buzz', componentName: '有源蜂鸣器', sourcePin: 'IN', target: 'Arduino Uno', targetPin: 'D2' }
  ], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.equal(inventedAlias.spec.connections.filter(item => /^(?:SIG|IN)$/.test(item.sourcePin)).length, 1, 'known hardware must not retain an invented second signal alias');
assert.ok(inventedAlias.spec.connections.some(item => item.sourcePin === 'SIG' && item.targetPin === 'D8'));

const sharedSpi = resolveHardwareConnections({
  version: 1, goal: 'RFID记录到SD卡', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [
    { id: 'rfid', name: 'RC522 RFID模块', role: 'input', quantity: 1 },
    { id: 'sd', name: 'Micro SD卡模块', role: 'output', quantity: 1 }
  ], connections: [], libraries: [], behaviors: [], acceptance: [{ id: 'a', description: '读卡并记录', evidence: 'user' }], risks: []
});
assert.deepEqual(sharedSpi.unresolved, []);
assert.ok(!evaluateProjectSpec(sharedSpi.spec).some(issue => issue.includes('信号引脚可能冲突')), 'SPI devices may share SCK/MOSI/MISO');
const chipSelectPins = sharedSpi.spec.connections.filter(item => /^(?:SS|CS)$/.test(item.sourcePin)).map(item => item.targetPin);
assert.equal(new Set(chipSelectPins).size, 2, 'each SPI device needs a unique chip-select pin');

const ordinaryStrip = resolveHardwareConnections({
  version: 1, goal: '普通植物灯', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
  components: [{ id: 'lamp', name: '12V普通植物灯带', role: 'output', voltage: '12V', quantity: 1 }],
  connections: [
    { componentId: 'lamp', componentName: '12V普通植物灯带', sourcePin: 'VCC', target: '12V电源', targetPin: '12V' },
    { componentId: 'lamp', componentName: '12V普通植物灯带', sourcePin: 'GND', target: 'MOSFET', targetPin: 'D' }
  ], libraries: [], behaviors: [], acceptance: [], risks: []
});
assert.deepEqual(ordinaryStrip.unresolved, []);
assert.ok(!ordinaryStrip.spec.libraries.includes('Adafruit NeoPixel'), 'ordinary two-wire strips must not be converted to addressable WS2812 strips');
assert.ok(!ordinaryStrip.spec.connections.some(item => item.sourcePin === 'DIN'), 'ordinary two-wire strips do not have DIN');

for (const discrete of [
  { name: '220Ω电阻', connections: [{ sourcePin: '1', target: 'Arduino Uno', targetPin: 'D5' }, { sourcePin: '2', target: 'LED', targetPin: 'A' }] },
  { name: '1N4007二极管', connections: [{ sourcePin: 'A', target: '水泵', targetPin: '-' }, { sourcePin: 'K', target: '水泵', targetPin: '+' }] },
  { name: 'IRLZ44N MOSFET', connections: [{ sourcePin: 'G', target: '电阻', targetPin: '2' }, { sourcePin: 'D', target: '水泵', targetPin: '-' }, { sourcePin: 'S', target: 'Arduino Uno', targetPin: 'GND' }] },
  { name: 'S8050三极管', connections: [{ sourcePin: 'B', target: '电阻', targetPin: '2' }, { sourcePin: 'C', target: '负载', targetPin: '-' }, { sourcePin: 'E', target: 'Arduino Uno', targetPin: 'GND' }] }
]) {
  const result = resolveHardwareConnections({
    version: 1, goal: '分立元件测试', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V', confirmed: false },
    components: [{ id: 'part', name: discrete.name, role: 'other', quantity: 1 }],
    connections: discrete.connections.map(item => ({ componentId: 'part', componentName: discrete.name, ...item })),
    libraries: [], behaviors: [], acceptance: [], risks: []
  });
  assert.deepEqual(result.unresolved, [], `${discrete.name} should preserve a complete real topology`);
  assert.ok(!result.spec.connections.some(item => item.sourcePin === 'VCC'), `${discrete.name} must not receive invented module power pins`);
}
console.log('hardware catalog tests passed');
