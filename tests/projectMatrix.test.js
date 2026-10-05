// A deterministic, cross-project gate. These are NOT claims that an AI model
// generated the projects or that physical hardware has been tested.
const assert = require('node:assert/strict');
const { normalizeProjectSpec, evaluateProjectSpec, evaluateCodeAgainstSpec } = require('../dist/workflow');

const fallback = { goal: '', sensor: '', output: '', sensorPin: '', outputPin: '', wiring: [], libraries: [] };
const board = { name: 'Arduino Uno', fqbn: 'arduino:avr:uno', voltage: '5V' };
const part = (id, name, role, voltage) => ({ id, name, role, voltage, quantity: 1 });
const wire = (id, name, sourcePin, targetPin, signalType) => ({ componentId: id, componentName: name, sourcePin, target: 'Arduino Uno', targetPin, signalType });
const moduleWires = (id, name, signals, voltage = '5V') => [
  ...signals.map(([source, pin, kind]) => wire(id, name, source, pin, kind)),
  wire(id, name, 'VCC', voltage), wire(id, name, 'GND', 'GND')
];
const sketch = (pins, work) => `#include <Arduino.h>\n${pins.map(([name, pin]) => `const int ${name}_PIN = ${pin};`).join('\n')}\nvoid setup(){}\nvoid loop(){${work}}`;

const cases = [
  { id: 'ambient-led', family: 'analog + PWM', goal: '光敏传感器控制LED亮度',
    components: [part('ldr', '光敏传感器', 'input', '5V'), part('led', 'LED模块', 'output', '5V')],
    connections: [...moduleWires('ldr', '光敏传感器', [['AO', 'A0']]), ...moduleWires('led', 'LED模块', [['SIG', 'D9']])],
    code: sketch([['LIGHT', 'A0'], ['LED', 9]], 'analogWrite(LED_PIN,analogRead(LIGHT_PIN)/4);') },
  { id: 'button-buzzer', family: 'digital input/output', goal: '按钮按下蜂鸣器响',
    components: [part('button', '按钮模块', 'input', '5V'), part('buzz', '蜂鸣器模块', 'output', '5V')],
    connections: [...moduleWires('button', '按钮模块', [['SIG', 'D2']]), ...moduleWires('buzz', '蜂鸣器模块', [['SIG', 'D8']])],
    code: sketch([['BUTTON', 2], ['BUZZER', 8]], 'digitalWrite(BUZZER_PIN,digitalRead(BUTTON_PIN));') },
  { id: 'ultrasonic-servo', family: 'two-pin sensor + actuator', goal: '超声波感应开门',
    components: [part('range', 'HC-SR04超声波', 'input', '5V'), part('servo', '舵机模块', 'output', '5V')],
    connections: [...moduleWires('range', 'HC-SR04超声波', [['TRIG', 'D2'], ['ECHO', 'D3']]), ...moduleWires('servo', '舵机模块', [['SIG', 'D9']])],
    code: sketch([['TRIG', 2], ['ECHO', 3], ['SERVO', 9]], 'digitalWrite(TRIG_PIN,HIGH);pulseIn(ECHO_PIN,HIGH);digitalWrite(SERVO_PIN,LOW);') },
  { id: 'soil-relay', family: 'analog + switched load', goal: '土壤干燥时继电器启动水泵',
    components: [part('soil', '土壤湿度模块', 'input', '5V'), part('relay', '继电器模块', 'output', '5V')],
    connections: [...moduleWires('soil', '土壤湿度模块', [['AO', 'A0']]), ...moduleWires('relay', '继电器模块', [['IN', 'D7']])],
    code: sketch([['SOIL', 'A0'], ['RELAY', 7]], 'digitalWrite(RELAY_PIN,analogRead(SOIL_PIN)>600);') },
  { id: 'temperature-screen', family: 'digital + shared I2C', goal: '温湿度显示在OLED上',
    components: [part('dht', 'DHT22温湿度', 'input', '5V'), part('oled', 'SSD1306 OLED', 'output', '5V')],
    connections: [...moduleWires('dht', 'DHT22温湿度', [['DATA', 'D4']]), ...moduleWires('oled', 'SSD1306 OLED', [['SDA', 'A4', 'I2C'], ['SCL', 'A5', 'I2C']])],
    code: sketch([['DHT', 4], ['OLED_SDA', 'A4'], ['OLED_SCL', 'A5']], 'digitalRead(DHT_PIN);') },
  { id: 'two-i2c-devices', family: 'shared bus', goal: '颜色传感器和OLED共用I2C',
    components: [part('color', 'TCS34725', 'input', '5V'), part('oled', 'SSD1306 OLED', 'output', '5V')],
    connections: [...moduleWires('color', 'TCS34725', [['SDA', 'A4', 'I2C'], ['SCL', 'A5', 'I2C']]), ...moduleWires('oled', 'SSD1306 OLED', [['SDA', 'A4', 'I2C'], ['SCL', 'A5', 'I2C']])],
    code: sketch([['SDA', 'A4'], ['SCL', 'A5']], 'delay(10);') },
  { id: 'two-servo-arm', family: 'multiple actuators', goal: '按钮控制双舵机',
    components: [part('button', '按钮模块', 'input', '5V'), part('left', '左舵机', 'output', '5V'), part('right', '右舵机', 'output', '5V')],
    connections: [...moduleWires('button', '按钮模块', [['SIG', 'D2']]), ...moduleWires('left', '左舵机', [['SIG', 'D9']]), ...moduleWires('right', '右舵机', [['SIG', 'D10']])],
    code: sketch([['BUTTON', 2], ['LEFT', 9], ['RIGHT', 10]], 'digitalRead(BUTTON_PIN);digitalWrite(LEFT_PIN,HIGH);digitalWrite(RIGHT_PIN,HIGH);') },
  { id: 'strip-and-sound', family: 'addressable lighting', goal: '声音变化驱动WS2812',
    components: [part('sound', '声音传感器', 'input', '5V'), part('strip', 'WS2812灯带', 'output', '5V')],
    connections: [...moduleWires('sound', '声音传感器', [['AO', 'A0']]), ...moduleWires('strip', 'WS2812灯带', [['DIN', 'D5']])],
    code: sketch([['SOUND', 'A0'], ['STRIP', 5]], 'analogRead(SOUND_PIN);digitalWrite(STRIP_PIN,HIGH);') }
];

let checks = 0;
for (const example of cases) {
  const spec = normalizeProjectSpec({ ...example, board, acceptance: [{ id: 'run', description: example.goal, evidence: 'user' }] }, fallback);
  const issues = evaluateProjectSpec(spec);
  assert.deepEqual(issues, [], `${example.id}: unexpected wiring warnings: ${issues.join('; ')}`);
  const codeIssues = evaluateCodeAgainstSpec(example.code, spec);
  assert.deepEqual(codeIssues, [], `${example.id}: unexpected code warnings: ${codeIssues.join('; ')}`);
  checks += 2;

  const missingSignal = structuredClone(spec);
  const lost = missingSignal.connections.findIndex(item => !/^(VCC|GND)$/i.test(item.sourcePin));
  missingSignal.connections.splice(lost, 1);
  if (!missingSignal.connections.some(item => item.componentId === spec.connections[lost].componentId && !/^(VCC|GND)$/i.test(item.sourcePin))) {
    assert.ok(evaluateProjectSpec(missingSignal).some(item => /缺少信号|没有对应接线/.test(item)), `${example.id}: missing signal not detected`);
    checks++;
  }

  const foreignPin = example.code.replace('void loop(){', 'void loop(){digitalWrite(12,HIGH);');
  assert.ok(evaluateCodeAgainstSpec(foreignPin, spec).some(item => /接线表之外的引脚/.test(item)), `${example.id}: unselected pin not detected`);
  checks++;
}

// Safety case: independent active devices on the same output pin are not a bus.
const conflict = normalizeProjectSpec({ ...cases[1], board, connections: cases[1].connections.map(item => item.componentId === 'buzz' && item.sourcePin === 'SIG' ? { ...item, targetPin: 'D2' } : item) }, fallback);
assert.ok(evaluateProjectSpec(conflict).some(item => /信号引脚可能冲突/.test(item)));
checks++;

console.log(`project matrix passed: ${cases.length} project families, ${checks} static gates (no model or physical-hardware claim)`);
