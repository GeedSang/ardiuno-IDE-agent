const assert = require('node:assert/strict');
const { classifyComponentConnection } = require('../dist/componentClassification');

const expectKind = (names, kind, role = 'other') => {
  for (const name of names) assert.equal(classifyComponentConnection({ name, role }).kind, kind, `${name} should be ${kind}`);
};

expectKind(['杜邦线', '公对母跳线', 'USB数据线', '5V电源线', '鳄鱼夹线', '40P彩排线', '面包板', '洞洞板', '2.54mm排针', '螺钉端子台'], 'wiring-accessory');
expectKind(['防水盒', '隔水板', '亚克力安装板', 'DIN导轨', '舵机支架', 'M3螺丝', '尼龙扎带', '热缩管', '密封圈', '储水箱', '硅胶水管', '滴灌三通', '过滤棉', '万用表'], 'mechanical-accessory');
expectKind(['温湿度传感器', '防水温度传感器', '水箱液位传感器', '水泵模块', '电磁阀', '继电器模块', 'WS2812灯带', 'OLED显示屏', '蜂鸣器', 'HC-05蓝牙模块', '电池盒', '10k电阻'], 'electrical');
assert.equal(classifyComponentConnection({ name: '完全未知零件', role: 'input' }).kind, 'electrical');
assert.equal(classifyComponentConnection({ name: '完全未知零件', role: 'other', interface: 'I2C' }).kind, 'electrical');
assert.equal(classifyComponentConnection({ name: '完全未知零件', role: 'other' }).kind, 'unknown');
assert.equal(classifyComponentConnection({ name: '项目保护盒', role: 'input' }).kind, 'mechanical-accessory', 'an obvious enclosure overrides an incorrect AI role');
assert.equal(classifyComponentConnection({ name: '防水温度传感器', role: 'other' }).kind, 'electrical', 'waterproof electrical sensors remain electrical');
console.log('component classification tests passed');
