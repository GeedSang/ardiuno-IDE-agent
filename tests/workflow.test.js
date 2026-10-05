const assert = require('node:assert/strict');
const { initialWorkflow, updateWorkflow, addEvidence, confirmObservedCriteria, normalizeLibraryNames, normalizeProjectSpec, repairKnownHardwareConnections, evaluateProjectSpec, evaluateCodeAgainstSpec, codeContainsRequiredNumber, nextAction } = require('../dist/workflow');

assert.deepEqual(normalizeLibraryNames([{ name: 'Servo' }, { libraryName: 'Adafruit NeoPixel' }, '[object Object]']), ['Servo', 'Adafruit NeoPixel']);

const state = updateWorkflow(initialWorkflow(), { phase: 'wiring', status: 'needs-user', message: '确认接线' });
assert.equal(codeContainsRequiredNumber('const int NUM_LEDS = 80; const int LEVELS = 5;', '80'), true);
assert.equal(codeContainsRequiredNumber('const int NUM_LEDS = 80; const int LEVELS = 5;', '5'), true);
assert.equal(codeContainsRequiredNumber('const int NUM_LEDS = 800;', '80'), false);
assert.equal(nextAction(state).command, 'arduinoFirstRunAgent.confirmWiring');
assert.equal(nextAction(updateWorkflow(state, { phase: 'blocked', status: 'error' })).command, 'arduinoFirstRunAgent.retry');
const physical = { acceptance: [
  { id: 'upload', evidence: 'upload', passed: false },
  { id: 'sensor', evidence: 'user', passed: false },
  { id: 'output', evidence: 'user', passed: false }
] };
assert.deepEqual(confirmObservedCriteria(physical, ['sensor', 'upload', 'unknown']), { confirmed: 1, remaining: 1 });
assert.deepEqual(physical.acceptance.map(item => item.passed), [false, true, false], 'user feedback must not fabricate upload or other observed evidence');
assert.deepEqual(confirmObservedCriteria(physical, ['output']), { confirmed: 1, remaining: 0 });
const firstFailure = addEvidence(initialWorkflow(), { tool: 'generator', ok: false, summary: '硬件方案校验未通过', detail: '第一次原因' });
const repeatedFailure = addEvidence(firstFailure, { tool: 'generator', ok: false, summary: '硬件方案校验未通过', detail: '最新原因' });
assert.equal(repeatedFailure.evidence.length, 1);
assert.equal(repeatedFailure.evidence[0].detail, '最新原因');

const aliasSpec = normalizeProjectSpec({
  components: [{ id: 'screen', name: 'OLED SSD1306 Display', model: 'SSD1306', role: 'output', interface: 'I2C' }],
  connections: [{ componentId: 'oled', componentName: 'OLED', sourcePin: 'SDA', target: 'Arduino', targetPin: 'SDA', signalType: 'I2C' }]
}, { goal: '显示数据', sensor: '', output: 'OLED', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
assert.equal(aliasSpec.connections[0].componentId, 'screen');
assert.ok(!evaluateProjectSpec(aliasSpec).some(issue => issue.includes('没有对应接线')));

const spec = normalizeProjectSpec({
  goal: '光线暗时点亮LED', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  components: [{ id: 'ldr', name: '光敏传感器', role: 'input', quantity: 1 }, { id: 'led', name: 'LED', role: 'output', quantity: 1 }],
  connections: [
    { componentId: 'ldr', componentName: '光敏传感器', sourcePin: 'AO', target: 'Arduino', targetPin: 'A0' },
    { componentId: 'led', componentName: 'LED', sourcePin: 'SIG', target: 'Arduino', targetPin: 'D9' }
  ], acceptance: [{ id: 'a1', description: '暗处LED点亮', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
assert.deepEqual(evaluateProjectSpec(spec), []);

const accessorySpec = normalizeProjectSpec({
  goal: '按钮项目', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  components: [
    { id: 'button', name: '按钮模块', role: 'input', quantity: 1 },
    { id: 'wires', name: '杜邦连接线', role: 'other', quantity: 10 }
  ],
  connections: [
    { componentId: 'button', componentName: '按钮模块', sourcePin: 'SW', target: 'Arduino', targetPin: 'D2' }
  ], acceptance: [{ id: 'a1', description: '按钮有响应', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
assert.ok(!evaluateProjectSpec(accessorySpec).some(issue => issue.includes('杜邦连接线')));

const enclosureSpec = normalizeProjectSpec({
  goal: '防水自动浇水', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  components: [
    { id: 'pump', name: '5V水泵模块', role: 'output', quantity: 1 },
    { id: 'case', name: '防水盒', role: 'other', interface: '机械辅材/无需接线', quantity: 1 },
    { id: 'divider', name: '隔水板', role: 'other', quantity: 1 }
  ],
  connections: [
    { componentId: 'pump', componentName: '5V水泵模块', sourcePin: 'SIG', target: 'Arduino', targetPin: 'D5' }
  ]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
const enclosureIssues = evaluateProjectSpec(enclosureSpec);
assert.ok(!enclosureIssues.some(issue => /防水盒|隔水板/.test(issue)));

const unsafeCrossWiring = normalizeProjectSpec({
  goal: '声音控制灯带',
  board: { name: 'Arduino Mega', fqbn: 'arduino:avr:mega', voltage: '5V' },
  components: [
    { id: 'mic', name: '声音传感器', role: 'input', voltage: '5V' },
    { id: 'strip', name: 'WS2812 可编程灯带', role: 'output', voltage: '5V' }
  ],
  connections: [
    { componentId: 'mic', componentName: '声音传感器', sourcePin: 'A0', target: 'Arduino Mega', targetPin: 'A0' },
    { componentId: 'mic', componentName: '声音传感器', sourcePin: 'D6', target: 'Arduino Mega', targetPin: 'D6' },
    { componentId: 'mic', componentName: '声音传感器', sourcePin: 'VCC', target: 'WS2812 可编程灯带', targetPin: 'VCC' },
    { componentId: 'mic', componentName: '声音传感器', sourcePin: 'GND', target: 'WS2812 可编程灯带', targetPin: 'GND' }
  ]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
const unsafeIssues = evaluateProjectSpec(unsafeCrossWiring);
assert.ok(unsafeIssues.some(issue => issue.includes('不应直接接到另一个传感器或执行器')));
assert.ok(unsafeIssues.some(issue => issue.includes('模块端引脚被错误写成开发板引脚')));
assert.ok(unsafeIssues.some(issue => issue.includes('WS2812 可编程灯带 没有对应接线')));
const repairedAudio = repairKnownHardwareConnections(unsafeCrossWiring);
assert.deepEqual(evaluateProjectSpec(repairedAudio), []);
assert.ok(repairedAudio.connections.some(item => item.componentName.includes('声音') && item.sourcePin === 'AO' && item.targetPin === 'A0'));
assert.ok(repairedAudio.connections.some(item => item.componentName.includes('WS2812') && item.sourcePin === 'DIN' && item.targetPin === 'D6'));
assert.ok(repairedAudio.connections.some(item => item.componentName.includes('WS2812') && item.sourcePin === 'VCC' && item.target.includes('独立')));
assert.deepEqual(evaluateCodeAgainstSpec('void setup(){pinMode(9,OUTPUT);} void loop(){analogRead(A0);}', spec), []);
assert.ok(evaluateCodeAgainstSpec('void setup(){} void loop(){}', spec).length >= 2);

const mergedPowerSpec = normalizeProjectSpec({
  goal: '读取DHT22', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V' },
  components: [{ id: 'dht', name: 'DHT22 温湿度传感器', role: 'input', voltage: '5V', quantity: 1 }],
  connections: [{ componentId: 'dht', componentName: 'DHT22', sourcePin: 'DATA', target: 'Arduino', targetPin: 'D2' }],
  wiring: ['DHT22 VCC -> Arduino 5V', 'DHT22 GND -> Arduino GND'],
  acceptance: [{ id: 'a1', description: '读到温湿度', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: ['DHT22 VCC -> Arduino 5V', 'DHT22 GND -> Arduino GND'], libraries: [] });
assert.equal(mergedPowerSpec.connections.length, 3);
assert.deepEqual(evaluateProjectSpec(mergedPowerSpec), []);

const armSpec = normalizeProjectSpec({
  goal: '四自由度机械臂分拣', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V' },
  components: [
    { id: 'base', name: '底座舵机', role: 'output', quantity: 1 },
    { id: 'shoulder', name: '大臂舵机', role: 'output', quantity: 1 },
    { id: 'elbow', name: '小臂舵机', role: 'output', quantity: 1 },
    { id: 'gripper', name: '夹爪舵机', role: 'output', quantity: 1 }
  ],
  connections: [
    { componentId: 'base', componentName: '底座舵机', sourcePin: 'SIG', target: 'Arduino', targetPin: 'D9' },
    { componentId: 'shoulder', componentName: '大臂舵机', sourcePin: 'SIG', target: 'Arduino', targetPin: 'D10' },
    { componentId: 'elbow', componentName: '小臂舵机', sourcePin: 'SIG', target: 'Arduino', targetPin: 'D11' },
    { componentId: 'gripper', componentName: '夹爪舵机', sourcePin: 'SIG', target: 'Arduino', targetPin: 'D12' }
  ],
  acceptance: [{ id: 'a1', description: '机械臂动作', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [
  '底座舵机 信号 -> Arduino D9', '大臂舵机 信号 -> Arduino D10', '小臂舵机 信号 -> Arduino D11', '夹爪舵机 信号 -> Arduino D12',
  '四个舵机 VCC -> 外部 5V 电源', '四个舵机 GND -> Arduino GND 共地'
], libraries: ['Servo'] });
assert.equal(armSpec.connections.filter(item => /^D(?:9|10|11|12)$/.test(item.targetPin)).length, 4);
assert.ok(!evaluateProjectSpec(armSpec).some(issue => issue.includes('信号引脚可能冲突')));

const discreteCircuitSpec = normalizeProjectSpec({
  goal: 'MOSFET控制负载', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V' },
  components: [
    { id: 'gate', name: '栅极限流电阻', model: '220Ω', role: 'other', quantity: 1 },
    { id: 'mosfet', name: 'N沟道MOSFET', model: 'IRLZ44N', role: 'other', quantity: 1 },
    { id: 'diode', name: '续流二极管', model: '1N4007', role: 'other', voltage: '5V', quantity: 1 }
  ],
  connections: [
    { componentId: 'gate', componentName: '栅极限流电阻', sourcePin: '1', target: 'Arduino Uno', targetPin: 'D2' },
    { componentId: 'gate', componentName: '栅极限流电阻', sourcePin: '2', target: 'N沟道MOSFET', targetPin: 'G' },
    { componentId: 'mosfet', componentName: 'N沟道MOSFET', sourcePin: 'G', target: 'Arduino Uno', targetPin: 'D2' },
    { componentId: 'mosfet', componentName: 'N沟道MOSFET', sourcePin: 'D', target: '水泵', targetPin: '-' },
    { componentId: 'mosfet', componentName: 'N沟道MOSFET', sourcePin: 'S', target: 'Arduino Uno', targetPin: 'GND' },
    { componentId: 'diode', componentName: '续流二极管', sourcePin: 'A', target: '水泵', targetPin: '-' },
    { componentId: 'diode', componentName: '续流二极管', sourcePin: 'K', target: '水泵', targetPin: '+' }
  ], acceptance: [{ id: 'a', description: '负载受控', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
const discreteIssues = evaluateProjectSpec(discreteCircuitSpec);
assert.ok(!discreteIssues.some(issue => /续流二极管.*VCC|续流二极管.*GND/.test(issue)), 'a discrete diode must not be treated as a powered module');
assert.ok(!discreteIssues.some(issue => issue.includes('信号引脚可能冲突')), 'one electrical node through discrete parts may share a board pin');

const realPinConflict = normalizeProjectSpec({
  goal: '两个独立模块', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V' },
  components: [{ id: 'a', name: '按钮模块', role: 'input' }, { id: 'b', name: '蜂鸣器模块', role: 'output' }],
  connections: [
    { componentId: 'a', componentName: '按钮模块', sourcePin: 'SIG', target: 'Arduino Uno', targetPin: 'D2' },
    { componentId: 'b', componentName: '蜂鸣器模块', sourcePin: 'SIG', target: 'Arduino Uno', targetPin: 'D2' }
  ], acceptance: [{ id: 'a', description: '模块工作', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
assert.ok(evaluateProjectSpec(realPinConflict).some(issue => issue.includes('信号引脚可能冲突')), 'unrelated active modules must still conflict on the same pin');

const normalizedChecks = normalizeProjectSpec({
  goal: '距离报警',
  board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  components: [{ id: 'sensor', name: 'HC-SR04', role: 'input' }],
  connections: [{ componentId: 'sensor', componentName: 'HC-SR04', sourcePin: 'TRIG', target: 'Arduino Uno', targetPin: 'D7' }],
  behaviors: [
    { id: 'a', trigger: '持续运行', action: '小于20厘米时报警', parameters: { threshold: 20 } },
    { id: 'b', trigger: '持续运行', action: '小于20厘米时报警', parameters: { threshold: 20 } }
  ],
  acceptance: [
    { id: 'a', description: '验证行为 1', evidence: 'compile' },
    { id: 'b', description: '验证行为 2', evidence: 'user' }
  ]
}, { goal: '距离报警', sensor: 'HC-SR04', output: '蜂鸣器', sensorPin: 'D7,D8', outputPin: 'D9', wiring: [], libraries: [] });
assert.equal(normalizedChecks.behaviors.length, 1, 'duplicate behaviors must collapse into one observable behavior');
assert.ok(normalizedChecks.acceptance.some(item => item.description.includes('小于20厘米时报警') && item.evidence === 'user'), 'generic acceptance labels must become an observable user check');
assert.ok(normalizedChecks.acceptance.some(item => item.evidence === 'compile'), 'fallback acceptance must retain a compile gate');

const classicBoardVoltage = normalizeProjectSpec({ board: { name: 'Arduino Uno R3', fqbn: 'arduino:avr:uno', voltage: '3.3V' } }, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
assert.equal(classicBoardVoltage.board.voltage, '5V', 'classic AVR board voltage must come from the known FQBN, not a model guess');

const switchedLoad = normalizeProjectSpec({
  goal: '驱动风扇', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V' },
  components: [{ id: 'fan', name: '外部供电直流风扇', role: 'output', voltage: '12V' }],
  connections: [
    { componentId: 'fan', componentName: '外部供电直流风扇', sourcePin: '+', target: '12V电源', targetPin: '12V' },
    { componentId: 'fan', componentName: '外部供电直流风扇', sourcePin: '-', target: 'N沟道MOSFET', targetPin: 'D' }
  ], acceptance: [{ id: 'run', description: '风扇按阈值运行', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
assert.ok(!evaluateProjectSpec(switchedLoad).some(issue => /缺少电源|GND 没有连接|缺少 GND/.test(issue)), 'a two-wire load switched on the low side is not missing ground');
const brightnessSpec = normalizeProjectSpec({
  goal: '灯带', board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  components: [{ id: 'strip', name: 'WS2812灯带', role: 'output' }],
  connections: [{ componentId: 'strip', componentName: 'WS2812灯带', sourcePin: 'DIN', target: 'Arduino Uno', targetPin: 'D6' }],
  acceptance: [{ id: 'a', description: '灯带点亮', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] });
const brightnessIssues = evaluateCodeAgainstSpec('const uint8_t LED_PIN=6; const uint8_t LED_BRIGHTNESS=70; void setup(){pinMode(LED_PIN,OUTPUT);} void loop(){}', brightnessSpec);
assert.ok(!brightnessIssues.some(issue => issue.includes('D70')), 'a BRIGHTNESS constant ending in SS is not an SPI SS pin symbol');
const stateIndexIssues = evaluateCodeAgainstSpec('const uint8_t BUZZER_PIN=6; uint8_t buzzerStepIndex=0; uint8_t pinCount=1; void setup(){pinMode(BUZZER_PIN,OUTPUT);} void loop(){}', brightnessSpec);
assert.ok(!stateIndexIssues.some(issue => /buzzerStepIndex|pinCount|D0|D1/.test(issue)), 'ordinary state/index/count variables must not be interpreted as pin declarations');
assert.ok(!evaluateCodeAgainstSpec('#include <SPI.h>\n#include <MFRC522.h>\nvoid setup(){SPI.begin();} void loop(){}', normalizeProjectSpec({
  board: { name: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
  components: [{ id: 'llc', name: '电平转换模块', role: 'other' }],
  connections: [{ componentId: 'llc', componentName: '电平转换模块', sourcePin: 'HV1', target: 'Arduino Uno', targetPin: 'D13', signalType: 'SPI SCK' }],
  acceptance: [{ id: 'a', description: 'SPI工作', evidence: 'user' }]
}, { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] })).some(issue => issue.includes('D13')), 'hardware SPI bus pins are used by SPI.begin and must not require fake digitalWrite calls');
console.log('workflow tests passed');
