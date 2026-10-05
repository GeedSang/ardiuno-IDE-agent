const assert = require('assert');
const { localHardwareImage } = require('../dist/hardwareImages');

const ultrasonic = localHardwareImage('超声波传感器', 'HC-SR04', '传感器');
assert(ultrasonic, 'HC-SR04 should have an offline reference image');
assert(ultrasonic.dataUrl.startsWith('data:image/svg+xml;base64,'));
assert.strictEqual(ultrasonic.license, 'CC BY-SA 3.0');

assert.strictEqual(localHardwareImage('声音传感器', '未知模块', '传感器'), undefined, 'ambiguous hardware must use the generic fallback');
assert.strictEqual(localHardwareImage('WS2812灯带', '80灯', '灯带'), undefined, 'a single LED package must not be shown as a strip');
assert(localHardwareImage('六轴姿态传感器', 'MPU6050 GY-521', '传感器'), 'MPU6050 should have an offline reference image');
assert(localHardwareImage('蓝牙模块', 'HC-05', '通信'), 'HC-05 should have an offline reference image');
assert(localHardwareImage('Arduino开发板', 'Mega 2560', '主板'), 'Mega 2560 should have an offline reference image');
assert.strictEqual(localHardwareImage('OLED显示屏', 'SSD1306', '显示'), undefined, 'a Grove OLED must not be presented as a generic SSD1306 module');
assert.strictEqual(localHardwareImage('超声波传感器', '未知型号', '传感器'), undefined, 'a generic ultrasonic sensor must not be presented as HC-SR04');

console.log('hardware image catalog tests passed');
