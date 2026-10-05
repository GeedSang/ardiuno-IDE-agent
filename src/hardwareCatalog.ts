import type { ComponentSpec, ConnectionSpec, ProjectSpec } from './workflow';
import { isNonElectricalAccessory } from './componentClassification';

type HardwareRule = {
  name: string;
  match: RegExp;
  interface: string;
  libraries?: string[];
  headers?: string[];
  guidance: string;
};

const rules: HardwareRule[] = [
  { name: '声音传感器', match: /声音|麦克风|sound\s*sensor|microphone\s*(?:sensor|module)?|KY-?037|KY-?038/i, interface: '模拟输入', guidance: '优先使用AO模拟输出采样声音包络；DO仅适合阈值触发。' },
  { name: 'DHT11/DHT22', match: /DHT\s*(?:11|22)|温湿度/i, interface: '单总线数字信号', libraries: ['DHT sensor library'], headers: ['DHT.h'], guidance: '使用 DHT dht(pin,type)、begin/readTemperature/readHumidity；不存在 Adafruit_DHT.h 或 Adafruit_DHT 类。' },
  { name: 'DS18B20', match: /DS18B20/i, interface: 'OneWire', libraries: ['OneWire', 'DallasTemperature'], headers: ['OneWire.h', 'DallasTemperature.h'], guidance: '需要约4.7k上拉；不是I2C；使用 OneWire 与 DallasTemperature。' },
  { name: 'HC-SR04', match: /HC-?SR04|超声波/i, interface: 'TRIG+ECHO', libraries: ['NewPing'], headers: ['NewPing.h'], guidance: '需要两个数字引脚；可用NewPing或pulseIn；不是I2C。' },
  { name: 'TDS', match: /\bTDS\b|溶解固体/i, interface: '模拟输入', guidance: '必须analogRead采样、滤波并按校准参数换算；禁止返回固定常数或TODO。' },
  { name: '浊度传感器', match: /浊度|turbidity/i, interface: '模拟输入', guidance: '使用独立模拟引脚采样与校准，不是I2C。' },
  { name: '舵机', match: /舵机|servo/i, interface: 'PWM控制信号', libraries: ['Servo'], headers: ['Servo.h'], guidance: '使用Servo.attach/write；禁止digitalWrite(pin,90)；舵机应独立5V供电并共地。' },
  { name: 'MAX7219点阵', match: /MAX7219|MAX72XX|点阵/i, interface: 'SPI类三线', libraries: ['MD_MAX72XX'], headers: ['MD_MAX72xx.h'], guidance: '使用MD_MAX72XX真实API；不存在Adafruit_MAX72XX.h。' },
  { name: 'MSGEQ7', match: /MSGEQ7|频谱/i, interface: 'RESET+STROBE+模拟输入', libraries: ['MSGEQ7'], headers: ['MSGEQ7.h'], guidance: 'NicoHood库使用CMSGEQ7模板类及begin/read/get接口。' },
  { name: 'WS2812', match: /WS2812|WS2811|SK6812|NeoPixel|可编程|寻址|幻彩灯带/i, interface: '单线数字信号', libraries: ['Adafruit NeoPixel'], headers: ['Adafruit_NeoPixel.h'], guidance: '灯珠数量必须准确；大电流独立5V供电并共地。普通两线灯带不使用此库。' },
  { name: 'TCS34725', match: /TCS34725|颜色传感器/i, interface: 'I2C', libraries: ['Adafruit TCS34725'], headers: ['Adafruit_TCS34725.h'], guidance: '默认I2C地址0x29。' },
  { name: 'APDS9960', match: /APDS-?9960|手势传感器/i, interface: 'I2C', libraries: ['Adafruit APDS9960 Library'], headers: ['Adafruit_APDS9960.h'], guidance: '默认I2C地址0x39；按所选库真实API生成。' },
  { name: 'OLED SSD1306', match: /OLED|SSD1306/i, interface: 'I2C', libraries: ['Adafruit SSD1306', 'Adafruit GFX Library'], headers: ['Adafruit_SSD1306.h', 'Adafruit_GFX.h'], guidance: '常见地址0x3C；Uno上128x64缓冲区约占1KB SRAM。' },
  { name: 'LCD I2C', match: /(?:LCD|1602).*I2C|I2C.*(?:LCD|1602)|LiquidCrystal_I2C/i, interface: 'I2C', libraries: ['LiquidCrystal I2C'], headers: ['LiquidCrystal_I2C.h'], guidance: '常见地址0x27，必须调用init/backlight。未注明I2C的1602可能是并口版本，不能混用。' },
  { name: '环境类I2C传感器', match: /BME280|BMP280|BMP180|BH1750|SHT3\d|AHT(?:10|20)|CCS811|SGP30|INA219|ADS1115|MPU6050|MPU9250|ADXL345/i, interface: 'I2C', guidance: '先确认I2C地址、电压和所选库，再使用Wire总线。' },
  { name: 'RTC实时时钟', match: /DS3231|DS1307|RTC|实时时钟/i, interface: 'I2C', libraries: ['RTClib'], headers: ['RTClib.h'], guidance: '常见地址0x68；备用电池不等于主模块供电。' },
  { name: 'UART通信模块', match: /HC-?0[56]|蓝牙|GPS|NEO-?6M|指纹|AS608|串口屏|UART/i, interface: 'UART', guidance: 'TX连接开发板RX、RX连接开发板TX；Uno使用软件串口时应避开D0/D1。' },
  { name: 'RC522 RFID', match: /RC522|MFRC522/i, interface: 'SPI', libraries: ['MFRC522'], headers: ['MFRC522.h'], guidance: '使用SCK/MOSI/MISO/SS(RST另占数字引脚)，通常只兼容3.3V。不能把PN532等其他RFID模块套用此接线。' },
  { name: 'SD卡模块', match: /(?:^|\s)(?:Micro\s*)?SD(?:卡)?(?:模块)?(?:\s|$)/i, interface: 'SPI', libraries: ['SD'], headers: ['SD.h'], guidance: '使用SPI的SCK/MOSI/MISO并独占CS；确认模块是否带电平转换。' },
  { name: '旋转编码器', match: /旋转编码器|rotary\s*encoder|KY-?040/i, interface: 'CLK+DT+SW', guidance: 'CLK、DT为独立数字输入，SW为可选按键输入。' },
  { name: '步进驱动器', match: /A4988|DRV8825|TMC\d+|步进.*驱动/i, interface: 'STEP+DIR+EN', guidance: 'STEP、DIR和可选EN接数字口；电机电源与逻辑电源分开并共地。' },
  { name: 'HX711称重模块', match: /HX711|称重.*模块/i, interface: 'DT+SCK', libraries: ['HX711'], headers: ['HX711.h'], guidance: 'DT和SCK占用两个数字引脚；称重传感器四线接HX711而不是直接接Arduino。' },
  { name: 'MAX6675热电偶模块', match: /MAX6675|MAX31855/i, interface: 'SPI类三线', guidance: 'SCK、CS和SO(MISO)接开发板；热电偶本体接模块端子。' },
  { name: '摇杆模块', match: /摇杆|joystick/i, interface: '双模拟+按键', guidance: 'VRX、VRY分别占用模拟输入，SW为数字按键。' },
  { name: '矩阵键盘', match: /(?:\d+\s*[x×*]\s*\d+).*?(?:键盘|keypad)|(?:键盘|keypad).*?(?:\d+\s*[x×*]\s*\d+)/i, interface: '行列矩阵数字输入', libraries: ['Keypad'], headers: ['Keypad.h'], guidance: '按规格使用R行+C列数字引脚；薄膜矩阵键盘是无源触点，不需要VCC/GND。' },
  { name: '继电器', match: /继电器|relay/i, interface: '数字输出', guidance: '确认高低电平有效逻辑；负载独立供电，禁止直接由IO驱动大功率负载。' },
  { name: '直流电机/水泵/风扇', match: /电机|水泵|风扇|传送带/i, interface: '驱动器控制', guidance: '必须通过MOSFET、继电器或电机驱动器并配置续流保护，不能直接接Arduino IO。' }
];

type PinKind = 'analog' | 'digital' | 'pwm' | 'i2c-sda' | 'i2c-scl' | 'spi-sck' | 'spi-mosi' | 'spi-miso' | 'spi-cs';
type Terminal = { name: string; kind: PinKind };

const isSupportPart = (component: ComponentSpec): boolean => /电阻|resistor|电容|capacitor|二极管|diode|电感|inductor|保险丝|fuse|电源|power\s*supply|适配器|adapter|电平转换|level\s*(?:shifter|converter)/i.test(`${component.name} ${component.interface || ''}`);
const terminalKey = (value: string): string => {
  const pin = value.trim().toUpperCase().replace(/[\s_-]/g, '');
  if (/SDA\/SS|SS|CS/.test(pin)) return 'SS';
  if (/RESET|RST/.test(pin)) return 'RST';
  return pin;
};

function circuitTerminalIssues(component: ComponentSpec, connections: ConnectionSpec[]): string[] {
  const text = `${component.name} ${component.model || ''} ${component.interface || ''}`;
  const pins = connections.map(connection => connection.sourcePin.trim().toUpperCase());
  const has = (pattern: RegExp): boolean => pins.some(pin => pattern.test(pin));
  const issues: string[] = [];
  // Classify by the component itself, not by every word in its descriptive
  // name. For example, "MOSFET gate pull-down resistor" is still a resistor.
  const isTwoTerminalPassive = /电阻|resistor|电容|capacitor|电感|inductor|保险丝|fuse/i.test(text);
  const isDiode = !isTwoTerminalPassive && /二极管|\bdiode\b|1N\d+/i.test(text);
  const isMosfet = !isSupportPart(component) && !isTwoTerminalPassive && !isDiode && /MOSFET/i.test(text) && !/模块|驱动器|driver/i.test(text);
  const isTransistor = !isSupportPart(component) && !isTwoTerminalPassive && !isDiode && /三极管|transistor|\b(?:S8050|S8550|2N\d+|BC\d+|TIP\d+)\b/i.test(text) && !/模块|驱动/i.test(text);
  if (isTwoTerminalPassive && new Set(pins).size < 2) issues.push(`${component.name}：两端元件必须提供两条端点接线`);
  if (isDiode && !(has(/^(?:A|ANODE|阳极)$/i) && has(/^(?:K|CATHODE|阴极)$/i))) issues.push(`${component.name}：二极管必须明确 A(阳极) 和 K(阴极) 接到哪里`);
  if (!isTwoTerminalPassive && /(?:^|[^A-Z])LED(?:$|[^A-Z])|发光二极管/i.test(text) && !/灯带|模块|WS281|NeoPixel/i.test(text) && !(has(/^(?:A|ANODE|阳极|\+)$/i) && has(/^(?:K|CATHODE|阴极|-)$/i))) issues.push(`${component.name}：裸 LED 必须明确 A(阳极)、K(阴极) 并串联限流电阻`);
  if (isMosfet && !(has(/^(?:G|GATE|栅极)$/i) && has(/^(?:D|DRAIN|漏极)$/i) && has(/^(?:S|SOURCE|源极)$/i))) issues.push(`${component.name}：裸 MOSFET 必须明确 G、D、S 三个端子`);
  if (isTransistor && !(has(/^(?:B|BASE|基极)$/i) && has(/^(?:C|COLLECTOR|集电极)$/i) && has(/^(?:E|EMITTER|发射极)$/i))) issues.push(`${component.name}：裸三极管必须明确 B、C、E 三个端子`);
  if (!isDiode && /\bL298N?\b/i.test(text) && !(has(/^OUT1$/i) && has(/^OUT2$/i))) issues.push(`${component.name}：电机驱动器必须保留 OUT1、OUT2 到负载的接线`);
  const twoWireLoad = !isTwoTerminalPassive && !isDiode && !isMosfet && !isTransistor && /水泵|pump|直流电机|DC\s*motor|电磁阀|solenoid|风扇|fan|加热片|heater|植物灯|普通灯(?:条|带)|单色.*(?:LED)?灯带|(?:LED)?灯带.*单色|2[- ]?wire.*(?:LED)?strip/i.test(text) && !/模块|驱动器|driver/i.test(text);
  const positive = has(/^(?:\+|V\+|VCC|VIN|\+?\d+(?:\.\d+)?V|正极|RED)$/i);
  const negative = has(/^(?:-|V-|GND|GROUND|负极|BLACK)$/i);
  if (twoWireLoad && !(positive && negative)) issues.push(`${component.name}：两线负载必须明确正极和负极/开关端接线`);
  return issues;
}

function terminalsFor(component: ComponentSpec): Terminal[] | undefined {
  const text = `${component.name} ${component.model || ''} ${component.interface || ''}`.replace(/[_\-]+/g, ' ');
  // Supporting circuit parts may mention the protected device in their name
  // (for example "RC522 SPI level shifter"). They must keep their own HV/LV
  // topology instead of inheriting the peripheral's signal contract.
  if (isSupportPart(component)) return undefined;
  // 裸分立元件和两线功率负载必须保留真实电路拓扑，不能虚构成 SIG/VCC/GND 模块。
  if (/电阻|resistor|电容|capacitor|二极管|diode|MOSFET|三极管|transistor|\b(?:S8050|S8550|2N\d+|BC\d+|TIP\d+)\b|电感|inductor|保险丝|fuse|裸\s*LED|发光二极管|直流电机|DC\s*motor|水泵|pump|电磁阀|solenoid|风扇|fan|加热片|heater|植物灯|普通灯(?:条|带)|称重传感器|load\s*cell|热电偶(?:探头)?/i.test(text) && !/模块|驱动器|driver|L298|A4988|DRV8825|TMC\d+|MAX6675|MAX31855/i.test(text)) return undefined;
  if (/HC\s*SR04|超声波|ultrasonic/i.test(text)) return [{ name: 'TRIG', kind: 'digital' }, { name: 'ECHO', kind: 'digital' }];
  if (/MSGEQ7|频谱/i.test(text)) return [{ name: 'RESET', kind: 'digital' }, { name: 'STROBE', kind: 'digital' }, { name: 'OUT', kind: 'analog' }];
  if (/MAX7219|MAX72XX|点阵/i.test(text)) return [{ name: 'CLK', kind: 'spi-sck' }, { name: 'DIN', kind: 'spi-mosi' }, { name: 'CS', kind: 'spi-cs' }];
  if (/L298N/i.test(text)) return [
    { name: 'ENA', kind: 'pwm' }, { name: 'IN1', kind: 'digital' }, { name: 'IN2', kind: 'digital' },
    { name: 'ENB', kind: 'pwm' }, { name: 'IN3', kind: 'digital' }, { name: 'IN4', kind: 'digital' }
  ];
  if (/A4988|DRV8825|TMC\d+|步进.*驱动/i.test(text)) return [{ name: 'STEP', kind: 'digital' }, { name: 'DIR', kind: 'digital' }, { name: 'EN', kind: 'digital' }];
  if (/RC522|MFRC522/i.test(text)) return [{ name: 'SCK', kind: 'spi-sck' }, { name: 'MOSI', kind: 'spi-mosi' }, { name: 'MISO', kind: 'spi-miso' }, { name: 'SS', kind: 'spi-cs' }, { name: 'RST', kind: 'digital' }];
  if (/(?:^|\s)(?:Micro\s*)?SD(?:卡)?(?:模块)?(?:\s|$)/i.test(text)) return [{ name: 'SCK', kind: 'spi-sck' }, { name: 'MOSI', kind: 'spi-mosi' }, { name: 'MISO', kind: 'spi-miso' }, { name: 'CS', kind: 'spi-cs' }];
  if (/TCS\s*34725|APDS\s*9960|OLED|SSD1306|BME280|BMP280|BMP180|BH1750|SHT3\d|AHT(?:10|20)|CCS811|SGP30|INA219|ADS1115|MPU6050|MPU9250|ADXL345|DS3231|DS1307|RTC|(?:LCD|1602).*I2C|I2C.*(?:LCD|1602)|LiquidCrystal_I2C|\bI2C\b/i.test(text)) return [{ name: 'SDA', kind: 'i2c-sda' }, { name: 'SCL', kind: 'i2c-scl' }];
  if (/HC\s*0[56]|蓝牙|GPS|NEO\s*6M|指纹|AS608|串口屏|UART/i.test(text)) return [{ name: 'TX', kind: 'digital' }, { name: 'RX', kind: 'digital' }];
  if (/旋转编码器|rotary\s*encoder|KY\s*040/i.test(text)) return [{ name: 'CLK', kind: 'digital' }, { name: 'DT', kind: 'digital' }, { name: 'SW', kind: 'digital' }];
  const keypad = text.match(/(\d+)\s*[x×*]\s*(\d+).*?(?:键盘|keypad)|(?:键盘|keypad).*?(\d+)\s*[x×*]\s*(\d+)/i);
  if (keypad) {
    const rows = Math.min(8, Number(keypad[1] || keypad[3]));
    const columns = Math.min(8, Number(keypad[2] || keypad[4]));
    if (rows >= 1 && columns >= 1) return [
      ...Array.from({ length: rows }, (_, index): Terminal => ({ name: `R${index + 1}`, kind: 'digital' })),
      ...Array.from({ length: columns }, (_, index): Terminal => ({ name: `C${index + 1}`, kind: 'digital' }))
    ];
  }
  if (/HX711|称重.*模块/i.test(text)) return [{ name: 'DT', kind: 'digital' }, { name: 'SCK', kind: 'digital' }];
  if (/MAX6675|MAX31855/i.test(text)) return [{ name: 'SCK', kind: 'spi-sck' }, { name: 'SO', kind: 'spi-miso' }, { name: 'CS', kind: 'spi-cs' }];
  if (/摇杆|joystick/i.test(text)) return [{ name: 'VRX', kind: 'analog' }, { name: 'VRY', kind: 'analog' }, { name: 'SW', kind: 'digital' }];
  if (/WS2812|NeoPixel|可编程灯带/i.test(text)) return [{ name: 'DIN', kind: 'digital' }];
  if (/DHT\s*(?:11|22)|温湿度|DS18B20/i.test(text)) return [{ name: 'DATA', kind: 'digital' }];
  if (/舵机|servo/i.test(text)) return [{ name: 'SIG', kind: 'pwm' }];
  if (/声音|麦克风|sound\s*sensor|microphone|KY\s*0?(?:37|38)|光敏|light\s*sensor|photoresistor|LDR|土壤|soil\s*moisture|TDS|浊度|turbidity|电位器|potentiometer|MQ\s*\d+|气体|烟雾|火焰|雨滴|水位|液位|模拟输入|analog\s*(?:input|sensor)/i.test(text)) return [{ name: 'AO', kind: 'analog' }];
  if (/按钮|按键|push\s*button|PIR|人体|motion\s*sensor|继电器|relay|蜂鸣器|buzzer|数字输入|数字输出|digital\s*(?:input|output)/i.test(text)) return [{ name: /继电器|relay/i.test(text) ? 'IN' : /按钮|按键|button/i.test(text) ? 'SW' : 'SIG', kind: 'digital' }];
  if (component.interface && /I2C/i.test(component.interface)) return [{ name: 'SDA', kind: 'i2c-sda' }, { name: 'SCL', kind: 'i2c-scl' }];
  if (component.interface && /模拟/i.test(component.interface)) return [{ name: 'AO', kind: 'analog' }];
  if (component.interface && /数字|PWM|单线/i.test(component.interface)) return [{ name: 'SIG', kind: /PWM/i.test(component.interface) ? 'pwm' : 'digital' }];
  return undefined;
}

export function resolveHardwareConnections(spec: ProjectSpec): { spec: ProjectSpec; unresolved: string[] } {
  // Prefer the MCU's internal pull-up for a passive button. A model may add an
  // unconnected pull-down resistor "for safety"; keeping it would create an
  // impossible shopping/wiring item rather than improve the circuit.
  spec.components = spec.components.filter(component => {
    const redundantButtonBias = component.addedForSafety === true && /电阻|resistor/i.test(`${component.name} ${component.model || ''}`) && /按钮|按键|button|switch/i.test(`${component.name} ${component.model || ''}`) && /上拉|下拉|pull/i.test(`${component.name} ${component.model || ''}`);
    return !redundantButtonBias || spec.connections.some(connection => connection.componentId === component.id);
  });
  // Normalize passive resistive sensors into a real voltage-divider topology.
  // Models often invent a third "SIG" leg on a bare LDR/thermistor or ground
  // the sensing leg directly. A bare two-terminal sensor needs a fixed divider
  // resistor and the analog input must observe their shared junction.
  const resistiveSensors = spec.components.filter(component => /光敏电阻|photoresistor|\bLDR\b|热敏电阻|thermistor|\bNTC\b|\bPTC\b/i.test(`${component.name} ${component.model || ''}`) && !/模块|module/i.test(`${component.name} ${component.model || ''}`));
  const claimedDividerIds = new Set<string>();
  resistiveSensors.forEach((sensor, sensorIndex) => {
    const sensorConnections = spec.connections.filter(connection => connection.componentId.trim().toLowerCase() === sensor.id.trim().toLowerCase());
    const namedTarget = sensorConnections.map(connection => `${connection.target || ''}`.toLowerCase());
    const divider = spec.components.find(component => !claimedDividerIds.has(component.id) && /分压.*电阻|电阻.*分压|divider\s*resistor/i.test(`${component.name} ${component.model || ''}`) &&
      ([component.name, component.model || '', component.id].map(value => value.toLowerCase()).some(value => value && namedTarget.some(target => target.includes(value))) ||
       (/左|left/i.test(sensor.name) && /左|left/i.test(component.name)) || (/右|right/i.test(sensor.name) && /右|right/i.test(component.name)))) ||
      spec.components.find(component => !claimedDividerIds.has(component.id) && /分压.*电阻|电阻.*分压|divider\s*resistor/i.test(`${component.name} ${component.model || ''}`));
    if (!divider) return;
    claimedDividerIds.add(divider.id);
    const dividerConnections = spec.connections.filter(connection => connection.componentId.trim().toLowerCase() === divider.id.trim().toLowerCase());
    const analogPin = [...sensorConnections, ...dividerConnections].map(connection => connection.targetPin.trim().toUpperCase()).find(pin => /^A\d+$/.test(pin)) || `A${sensorIndex}`;
    const boardName = spec.board.name || 'Arduino';
    spec.connections = spec.connections.filter(connection => ![sensor.id, divider.id].some(id => connection.componentId.trim().toLowerCase() === id.trim().toLowerCase()));
    spec.connections.push(
      { componentId: sensor.id, componentName: sensor.name, sourcePin: '1', target: boardName, targetPin: '5V', signalType: 'power', voltage: '5V', required: true, confirmed: false },
      { componentId: sensor.id, componentName: sensor.name, sourcePin: '2', target: divider.name, targetPin: '1', signalType: 'divider-node', required: true, confirmed: false },
      { componentId: divider.id, componentName: divider.name, sourcePin: '1', target: boardName, targetPin: analogPin, signalType: 'analog', required: true, confirmed: false },
      { componentId: divider.id, componentName: divider.name, sourcePin: '2', target: boardName, targetPin: 'GND', signalType: 'ground', required: true, confirmed: false }
    );
  });
  const isMega = /mega/i.test(`${spec.board.name} ${spec.board.fqbn}`);
  const analogPool = Array.from({ length: isMega ? 16 : 4 }, (_, index) => `A${index}`);
  const digitalPool = isMega
    ? [2,3,4,5,6,7,8,9,10,11,12,13,22,23,24,25,26,27,28,29,30,31].map(pin => `D${pin}`)
    : [...[2,3,4,5,6,7,8,9,10,11,12,13].map(pin => `D${pin}`), 'A0', 'A1', 'A2', 'A3'];
  const pwmPool = (isMega ? [2,3,4,5,6,7,8,9,10,11,12,13] : [3,5,6,9,10,11]).map(pin => `D${pin}`);
  const used = new Set<string>();
  const boardWords = [spec.board.name, 'arduino', '开发板', '主板', 'board'].map(value => value.toLowerCase()).filter(Boolean);
  const directBoardPin = (connection: ConnectionSpec): string | undefined => {
    const target = `${connection.target || ''}`.toLowerCase();
    if (!boardWords.some(word => target.includes(word)) || !/^(?:A\d+|D?\d+)$/i.test(connection.targetPin)) return undefined;
    return connection.targetPin.toUpperCase().replace(/^(?=\d)/, 'D');
  };
  const reservedPins = new Map<string, Set<string>>();
  for (const connection of spec.connections) {
    const pin = directBoardPin(connection);
    if (!pin) continue;
    const owners = reservedPins.get(pin) || new Set<string>();
    owners.add(connection.componentId.trim().toLowerCase());
    reservedPins.set(pin, owners);
  }
  // Rebuild a complete low-side MOSFET power stage when the selected parts
  // clearly describe one. This contract applies to any two-wire DC load, not
  // only a particular lamp/pump project.
  const bareMosfets = spec.components.filter(component => /MOSFET/i.test(`${component.name} ${component.model || ''}`) && !isSupportPart(component) && !/模块|驱动器|driver/i.test(`${component.name} ${component.model || ''}`));
  const powerLoads = spec.components.filter(component => /水泵|pump|直流电机|DC\s*motor|电磁阀|solenoid|风扇|fan|加热片|heater|植物灯|普通灯(?:条|带)|单色.*(?:LED)?灯带|(?:LED)?灯带.*单色|2[- ]?wire.*(?:LED)?strip/i.test(`${component.name} ${component.model || ''} ${component.interface || ''}`) && !/模块|驱动器|driver|WS281|NeoPixel/i.test(`${component.name} ${component.model || ''}`));
  const gateSeriesParts = spec.components.filter(component => /电阻|resistor/i.test(`${component.name} ${component.model || ''}`) && /栅极|gate/i.test(`${component.name} ${component.model || ''}`) && /串联|限流|series/i.test(`${component.name} ${component.model || ''}`));
  const gatePullDownParts = spec.components.filter(component => /电阻|resistor/i.test(`${component.name} ${component.model || ''}`) && /栅极|gate/i.test(`${component.name} ${component.model || ''}`) && /下拉|pull[- ]?down/i.test(`${component.name} ${component.model || ''}`));
  const loadPower = spec.components.find(component => component.role === 'power' && /电源|power|supply|PSU|电池|battery/i.test(`${component.name} ${component.model || ''} ${component.interface || ''}`));
  if (bareMosfets.length && powerLoads.length && gateSeriesParts.length && loadPower) {
    // Pair parts by explicit names/targets first, then by stable list order. This
    // keeps independent fan/heater/lock stages separate when several channels
    // use identical support parts.
    const lower = (v: string) => v.toLowerCase();
    const score = (a: ComponentSpec, b: ComponentSpec) => {
      const words = `${a.name} ${a.model || ''}`.split(/[\s_\-()（）]+/).filter(Boolean);
      const text = lower(`${b.name} ${b.model || ''}`);
      return words.reduce((n, word) => word.length > 1 && text.includes(lower(word)) ? n + 1 : n, 0);
    };
    const unusedFets = [...bareMosfets];
    const unusedSeries = [...gateSeriesParts];
    const unusedPulls = [...gatePullDownParts];
    const stages = powerLoads.map((load, index) => {
      const pick = <T extends ComponentSpec>(items: T[], fallbackIndex: number): T | undefined => {
        if (!items.length) return undefined;
        let best = items.find(item => score(load, item) > 0);
        if (!best) best = items[Math.min(fallbackIndex, items.length - 1)];
        items.splice(items.indexOf(best), 1);
        return best;
      };
      return { load, fet: pick(unusedFets, index), series: pick(unusedSeries, index), pull: pick(unusedPulls, index) };
    }).filter(stage => stage.fet && stage.series);
    const stageIds = new Set(stages.flatMap(stage => [stage.load.id, stage.fet!.id, stage.series!.id, stage.pull?.id]).filter(Boolean).map(id => String(id).trim().toLowerCase()));
    const oldStage = spec.connections.filter(connection => stageIds.has(connection.componentId.trim().toLowerCase()));
    spec.connections = spec.connections.filter(connection => !stageIds.has(connection.componentId.trim().toLowerCase()));
    stages.forEach((stage, index) => {
      const { load, fet, series, pull } = stage;
      const pwmPin = oldStage.filter(c => [fet!.id, series!.id, load.id].includes(c.componentId)).map(directBoardPin).find((pin): pin is string => pin !== undefined && pwmPool.includes(pin)) || pwmPool.find(pin => !reservedPins.has(pin)) || `D${9 + index}`;
      const supplyPin = loadPower.voltage || load.voltage || '外部电源正极';
      spec.connections.push(
        { componentId: load.id, componentName: load.name, sourcePin: '+', target: loadPower.name, targetPin: supplyPin, signalType: 'load-power', voltage: load.voltage, required: true, confirmed: false },
        { componentId: load.id, componentName: load.name, sourcePin: '-', target: fet!.name, targetPin: 'D', signalType: 'switched-return', required: true, confirmed: false },
        { componentId: fet!.id, componentName: fet!.name, sourcePin: 'D', target: load.name, targetPin: '-', signalType: 'switched-return', required: true, confirmed: false },
        { componentId: fet!.id, componentName: fet!.name, sourcePin: 'S', target: '外部电源与 Arduino 共地', targetPin: 'GND', signalType: 'ground', required: true, confirmed: false },
        { componentId: series!.id, componentName: series!.name, sourcePin: '1', target: spec.board.name || 'Arduino', targetPin: pwmPin, signalType: 'pwm', required: true, confirmed: false },
        { componentId: series!.id, componentName: series!.name, sourcePin: '2', target: fet!.name, targetPin: 'G', signalType: 'gate-drive', required: true, confirmed: false }
      );
      if (pull) spec.connections.push(
        { componentId: pull.id, componentName: pull.name, sourcePin: '1', target: fet!.name, targetPin: 'G', signalType: 'gate-pulldown', required: true, confirmed: false },
        { componentId: pull.id, componentName: pull.name, sourcePin: '2', target: '外部电源与 Arduino 共地', targetPin: 'GND', signalType: 'ground', required: true, confirmed: false }
      );
      reservedPins.set(pwmPin, new Set([series!.id.toLowerCase()]));
    });
  }
  // Rebuild a complete, deterministic RC522 SPI path when a level shifter was
  // selected. Model output commonly mixes direct wires with half-populated
  // HV/LV channels; retaining that mixture is electrically ambiguous. The
  // channel contract is derived from the peripheral interface, not a project.
  const rc522 = spec.components.find(component => /RC522|MFRC522/i.test(`${component.name} ${component.model || ''}`));
  const levelShifter = spec.components.find(component => /电平转换|level\s*(?:shifter|converter)/i.test(`${component.name} ${component.model || ''} ${component.interface || ''}`));
  if (rc522 && levelShifter) {
    const canonicalSignal = (value: string): string => /SDA\/SS|^(?:SS|CS)$/i.test(value.trim()) ? 'SS' : /^(?:RST|RESET)$/i.test(value.trim()) ? 'RST' : value.trim().toUpperCase();
    const signals = ['SCK', 'MOSI', 'MISO', 'SS', 'RST'];
    const direct = new Map<string, ConnectionSpec>();
    for (const connection of spec.connections.filter(item => item.componentId.trim().toLowerCase() === rc522.id.trim().toLowerCase())) {
      const signal = canonicalSignal(connection.sourcePin);
      if (signals.includes(signal) && boardWords.some(word => `${connection.target || ''}`.toLowerCase().includes(word))) direct.set(signal, connection);
    }
    for (const connection of spec.connections.filter(item => item.componentId.trim().toLowerCase() === levelShifter.id.trim().toLowerCase())) {
      const signal = canonicalSignal(connection.sourcePin);
      if (signals.includes(signal) && boardWords.some(word => `${connection.target || ''}`.toLowerCase().includes(word))) direct.set(signal, connection);
    }
    const defaults: Record<string, string> = { SCK: 'SCK', MOSI: 'MOSI', MISO: 'MISO', SS: 'D10', RST: 'D8' };
    spec.connections = spec.connections.filter(connection => {
      const owner = connection.componentId.trim().toLowerCase();
      if (owner === levelShifter.id.trim().toLowerCase() && (/^(?:HV|LV)\d+$/i.test(connection.sourcePin.trim()) || /^(?:VCC|VIN)$/i.test(connection.sourcePin.trim()) || signals.includes(canonicalSignal(connection.sourcePin)))) return false;
      if (owner === rc522.id.trim().toLowerCase() && signals.includes(canonicalSignal(connection.sourcePin))) return false;
      return true;
    });
    signals.forEach((signal, index) => {
      const channel = index + 1;
      const boardPin = direct.get(signal)?.targetPin || defaults[signal];
      spec.connections.push(
        { componentId: rc522.id, componentName: rc522.name, sourcePin: signal, target: levelShifter.name, targetPin: `LV${channel}`, signalType: `spi-${signal.toLowerCase()}`, required: true, confirmed: false },
        { componentId: levelShifter.id, componentName: levelShifter.name, sourcePin: `HV${channel}`, target: spec.board.name || 'Arduino', targetPin: boardPin, signalType: `spi-${signal.toLowerCase()}`, required: true, confirmed: false }
      );
    });
    const shifterPower = spec.connections.filter(connection => connection.componentId.trim().toLowerCase() === levelShifter.id.trim().toLowerCase());
    if (!shifterPower.some(connection => /^HV$/i.test(connection.sourcePin))) spec.connections.push({ componentId: levelShifter.id, componentName: levelShifter.name, sourcePin: 'HV', target: spec.board.name || 'Arduino', targetPin: '5V', voltage: '5V', required: true, confirmed: false });
    if (!shifterPower.some(connection => /^LV$/i.test(connection.sourcePin))) spec.connections.push({ componentId: levelShifter.id, componentName: levelShifter.name, sourcePin: 'LV', target: spec.board.name || 'Arduino', targetPin: '3.3V', voltage: '3.3V', required: true, confirmed: false });
    if (!shifterPower.some(connection => /^GND$/i.test(connection.sourcePin))) spec.connections.push({ componentId: levelShifter.id, componentName: levelShifter.name, sourcePin: 'GND', target: spec.board.name || 'Arduino', targetPin: 'GND', required: true, confirmed: false });
  }
  // Complete the universally-defined series circuit for a bare indicator LED.
  // This is topology synthesis from component types, not a project template.
  const bareLeds = spec.components.filter(component => !isSupportPart(component) && /(?:^|[^A-Z])LED(?:$|[^A-Z])|发光二极管/i.test(`${component.name} ${component.model || ''}`) && !/OLED|灯带|模块|WS281|NeoPixel/i.test(`${component.name} ${component.model || ''}`));
  for (const led of bareLeds) {
    const ledConnections = spec.connections.filter(connection => connection.componentId === led.id);
    const hasAnode = ledConnections.some(connection => /^(?:A|ANODE|阳极|\+)$/i.test(connection.sourcePin)) || spec.connections.some(connection => `${connection.target || ''}`.toLowerCase().includes(led.name.toLowerCase()) && /^(?:A|ANODE|阳极|\+)$/i.test(connection.targetPin));
    const hasCathode = ledConnections.some(connection => /^(?:K|CATHODE|阴极|-)$/i.test(connection.sourcePin));
    const resistor = spec.components.find(component => /电阻|resistor/i.test(`${component.name} ${component.model || ''}`) && /LED|发光二极管|限流/i.test(`${component.name} ${component.model || ''}`));
    if (!resistor) continue;
    const resistorConnections = spec.connections.filter(connection => connection.componentId === resistor.id);
    if (!resistorConnections.length || !hasAnode) {
      const occupied = new Set([...reservedPins.keys()]);
      const signalPin = resistorConnections.find(connection => directBoardPin(connection))?.targetPin.toUpperCase().replace(/^(?=\d)/, 'D') ||
        [2,3,4,5,6,7,8,9,10,11,12,13].map(pin => `D${pin}`).find(pin => !occupied.has(pin)) || 'D7';
      spec.connections = spec.connections.filter(connection => connection.componentId !== resistor.id && !(connection.componentId === led.id && /^(?:A|ANODE|阳极|\+)$/i.test(connection.sourcePin)));
      spec.connections.push(
        { componentId: resistor.id, componentName: resistor.name, sourcePin: '1', target: spec.board.name || 'Arduino', targetPin: signalPin, signalType: 'digital', required: true, confirmed: false },
        { componentId: resistor.id, componentName: resistor.name, sourcePin: '2', target: led.name, targetPin: 'A', signalType: 'series', required: true, confirmed: false }
      );
      reservedPins.set(signalPin, new Set([resistor.id.toLowerCase()]));
    }
    if (!hasCathode) spec.connections.push({ componentId: led.id, componentName: led.name, sourcePin: 'K', target: spec.board.name || 'Arduino', targetPin: 'GND', signalType: 'ground', required: true, confirmed: false });
  }
  const output: ConnectionSpec[] = [];
  const unresolved: string[] = [];
  const boardName = spec.board.name || 'Arduino';
  const isMainBoardComponent = (component: ComponentSpec): boolean => /Arduino|ESP(?:32|8266)|STM32|开发板|主板/i.test(`${component.name} ${component.model || ''}`) ||
    `${component.name} ${component.model || ''}`.toLowerCase().includes(spec.board.name.toLowerCase());
  const boardVoltage = /3\.3V/i.test(spec.board.voltage || '') ? '3.3V' : '5V';
  const cleanName = (value: string): string => value.toLowerCase().replace(/[\s_\-（）()]/g, '').replace(/(?:模块|传感器|执行器|开发板)$/g, '');
  const existingFor = (component: ComponentSpec): ConnectionSpec[] => spec.connections.filter(connection => {
    const exactIds = spec.connections.some(item => item.componentId && item.componentId.trim().toLowerCase() === component.id.trim().toLowerCase());
    if (exactIds) return connection.componentId.trim().toLowerCase() === component.id.trim().toLowerCase();
    const connectionName = cleanName(connection.componentName || '');
    return Boolean(connectionName && [component.name, component.model || '', component.id].map(cleanName).filter(Boolean).some(name => connectionName.includes(name) || name.includes(connectionName)));
  });
  const incomingFor = (component: ComponentSpec): ConnectionSpec[] => spec.connections.filter(connection => {
    if (connection.componentId.trim().toLowerCase() === component.id.trim().toLowerCase() ||
      ![component.name, component.model || ''].map(value => value.toLowerCase()).filter(Boolean).some(name => `${connection.target || ''}`.toLowerCase().includes(name))) return false;
    const owner = spec.components.find(candidate => candidate.id.trim().toLowerCase() === connection.componentId.trim().toLowerCase());
    return Boolean(owner && (owner.role === 'power' || isSupportPart(owner) || /驱动|driver|继电器|relay|MOSFET|三极管|transistor/i.test(`${owner.name} ${owner.model || ''}`)));
  });
  const pick = (component: ComponentSpec, terminal: Terminal): string => {
    if (terminal.kind === 'i2c-sda') return 'SDA';
    if (terminal.kind === 'i2c-scl') return 'SCL';
    if (terminal.kind === 'spi-sck') { used.add(isMega ? 'D52' : 'D13'); return 'SCK'; }
    if (terminal.kind === 'spi-mosi') { used.add(isMega ? 'D51' : 'D11'); return 'MOSI'; }
    if (terminal.kind === 'spi-miso') { used.add(isMega ? 'D50' : 'D12'); return 'MISO'; }
    const componentText = `${component.name} ${component.model || ''}`;
    const servoWithoutExplicitGoalPin = /舵机|servo/i.test(componentText) && !/(?:舵机|servo).{0,20}\bD?\d+|\bD?\d+.{0,20}(?:舵机|servo)/i.test(spec.goal);
    const old = servoWithoutExplicitGoalPin ? undefined : spec.connections.find(connection => connection.componentId === component.id && connection.sourcePin.toUpperCase() === terminal.name && /^(?:A\d+|D?\d+)$/.test(connection.targetPin.toUpperCase()));
    if (old && !used.has(old.targetPin.toUpperCase().replace(/^(?=\d)/, 'D'))) { const normalized = old.targetPin.toUpperCase().startsWith('A') ? old.targetPin.toUpperCase() : `D${old.targetPin.replace(/^D/i, '')}`; used.add(normalized); return normalized; }
    const pool = terminal.kind === 'analog' ? analogPool : terminal.kind === 'pwm' && /舵机|servo/i.test(componentText)
      ? [...pwmPool.filter(pin => pin === 'D9'), ...pwmPool.filter(pin => pin !== 'D9')]
      : terminal.kind === 'pwm' ? pwmPool : digitalPool;
    const pin = pool.find(candidate => !used.has(candidate) && !(reservedPins.get(candidate)?.size && !reservedPins.get(candidate)?.has(component.id.trim().toLowerCase()))) || '';
    if (pin) used.add(pin);
    return pin;
  };
  for (const component of spec.components) {
    if ((component.role === 'controller' && isMainBoardComponent(component)) || component.role === 'power' || isNonElectricalAccessory(component)) continue;
    const existing = existingFor(component);
    const incoming = incomingFor(component);
    const terminals = terminalsFor(component);
    if (!terminals) {
      if (existing.length) {
        output.push(...existing.map(connection => ({ ...connection, componentId: component.id, componentName: component.name, required: connection.required !== false, confirmed: false })));
        for (const connection of existing) if (/^(?:A\d+|D?\d+)$/i.test(connection.targetPin)) used.add(connection.targetPin.toUpperCase().replace(/^(?=\d)/, 'D'));
      } else if (!incoming.length) unresolved.push(`${component.name}：缺少可验证的端子或接口资料，且方案没有提供可保留的接线`);
      continue;
    }
    for (const terminal of terminals) {
      const indirect = existing.find(connection => terminalKey(connection.sourcePin) === terminalKey(terminal.name) &&
        spec.components.some(other => other.id !== component.id && isSupportPart(other) &&
          [other.name, other.model || ''].filter(Boolean).some(name => `${connection.target || ''}`.toLowerCase().includes(name.toLowerCase()))));
      if (indirect) {
        output.push({ ...indirect, componentId: component.id, componentName: component.name, required: indirect.required !== false, confirmed: false });
        continue;
      }
      const pin = pick(component, terminal);
      if (!pin) { unresolved.push(`${component.name}：没有足够的 ${terminal.kind} 引脚`); continue; }
      output.push({ componentId: component.id, componentName: component.name, sourcePin: terminal.name, target: boardName, targetPin: pin, signalType: terminal.kind, required: true, confirmed: false });
    }
    const componentText = `${component.name} ${component.model || ''} ${component.interface || ''}`;
    const externalPower = /WS2812|NeoPixel|灯带|舵机|servo|电机|水泵|风扇|传送带/i.test(componentText);
    const passiveMatrix = /(?:\d+\s*[x×*]\s*\d+).*?(?:薄膜)?(?:键盘|keypad)|(?:薄膜)?(?:键盘|keypad).*?(?:\d+\s*[x×*]\s*\d+)/i.test(componentText) && !/模块|module|I2C/i.test(componentText);
    const passiveSwitch = /按钮|按键|button|switch/i.test(componentText) && /常开|常闭|轻触|裸|NO|NC/i.test(componentText) && !/模块|module/i.test(componentText);
    const targetsOtherPeripheral = (connection: ConnectionSpec): boolean => spec.components.some(other => other.id !== component.id && other.role !== 'power' &&
      [other.name, other.model || ''].filter(Boolean).some(name => `${connection.target || ''}`.toLowerCase().includes(name.toLowerCase())));
    const targetsSelf = (connection: ConnectionSpec): boolean => [component.name, component.model || ''].filter(Boolean).some(name => `${connection.target || ''}`.toLowerCase().includes(name.toLowerCase()));
    const positiveExisting = existing.filter(connection => /^(?:VCC|VIN|\+|V\+|\+5V|正极)$/i.test(connection.sourcePin) && !targetsOtherPeripheral(connection) && !targetsSelf(connection));
    const groundExisting = existing.filter(connection => /^(?:GND|GROUND|-|V-|负极)$/i.test(connection.sourcePin) && !targetsOtherPeripheral(connection) && !targetsSelf(connection));
    const supplyVoltage = /3\.3V/i.test(component.voltage || '') ? '3.3V' : /5V/i.test(component.voltage || '') ? '5V' : boardVoltage;
    if (!passiveMatrix && !passiveSwitch) {
      if (positiveExisting.length) output.push(...positiveExisting.map(connection => ({ ...connection, componentId: component.id, componentName: component.name, required: connection.required !== false, confirmed: false })));
      else output.push({ componentId: component.id, componentName: component.name, sourcePin: 'VCC', target: externalPower ? '独立稳定电源' : boardName, targetPin: externalPower ? (component.voltage || '5V') : supplyVoltage, voltage: component.voltage || supplyVoltage, required: true, confirmed: false });
      if (groundExisting.length) output.push(...groundExisting.map(connection => ({ ...connection, componentId: component.id, componentName: component.name, required: connection.required !== false, confirmed: false })));
      else output.push({ componentId: component.id, componentName: component.name, sourcePin: 'GND', target: externalPower ? '独立电源与 Arduino 共地' : boardName, targetPin: 'GND', required: true, confirmed: false });
    } else if (passiveSwitch) {
      const switchGround = existing.find(connection => /^(?:GND|GROUND|COM|NO|NC|-)$/i.test(connection.sourcePin) && /GND|GROUND|共地/i.test(`${connection.target} ${connection.targetPin}`));
      output.push(switchGround ? { ...switchGround, componentId: component.id, componentName: component.name, required: true, confirmed: false } :
        { componentId: component.id, componentName: component.name, sourcePin: 'COM', target: boardName, targetPin: 'GND', signalType: 'ground', required: true, confirmed: false });
    }
    for (const connection of existing) {
      const canonicalSignalAlreadyExists = terminals.some(terminal => terminal.name.toUpperCase() === connection.sourcePin.toUpperCase()) &&
        output.some(candidate => candidate.componentId === component.id && candidate.sourcePin.toUpperCase() === connection.sourcePin.toUpperCase());
      // 已识别硬件的标准信号端子只能出现一次。例如 HC-SR04 只有一个 ECHO，
      // 不能因为模型又给了另一个目标引脚就把第二条 ECHO 也保留下来。
      if (canonicalSignalAlreadyExists) continue;
      const sourcePin = connection.sourcePin.trim().toUpperCase();
      const connectsToBoardSignal = boardWords.some(word => `${connection.target || ''}`.toLowerCase().includes(word)) &&
        /^(?:A\d+|D?\d+|SDA|SCL|SCK|MOSI|MISO)$/i.test(connection.targetPin.trim());
      const isPowerTerminal = /^(?:VCC|VIN|GND|GROUND|GND\/-|\+|-|V\+|V-|\+?\d+(?:\.\d+)?V|正极|负极)$/i.test(sourcePin);
      const isKnownTerminal = terminals.some(terminal => terminal.name.toUpperCase() === sourcePin);
      // Once a component has a known terminal contract, model-invented aliases
      // must not create extra board signals. A single buzzer with canonical SIG,
      // for example, cannot also retain an invented IN on a second GPIO.
      if (connectsToBoardSignal && !isPowerTerminal && !isKnownTerminal) continue;
      if (isPowerTerminal && targetsOtherPeripheral(connection) && !isSupportPart(component)) continue;
      if (isPowerTerminal && targetsSelf(connection)) continue;
      if (passiveSwitch && /^(?:VCC|VIN|\+|V\+|\+5V|正极)$/i.test(sourcePin)) continue;
      if (passiveSwitch && !/^(?:SW|COM|NO|NC|GND|GROUND|-)$/i.test(sourcePin)) continue;
      const duplicate = output.some(candidate => candidate.componentId === component.id && candidate.sourcePin.toUpperCase() === connection.sourcePin.toUpperCase() && candidate.target.toLowerCase() === connection.target.toLowerCase() && candidate.targetPin.toUpperCase() === connection.targetPin.toUpperCase());
      if (!duplicate) output.push({ ...connection, componentId: component.id, componentName: component.name, required: connection.required !== false, confirmed: false });
    }
  }
  spec.connections = output;
  for (const component of spec.components) {
    const rule = isSupportPart(component) ? undefined : rules.find(item => item.match.test(`${component.name} ${component.model || ''}`));
    if (rule) {
      component.interface = rule.interface;
      for (const library of rule.libraries || []) if (!spec.libraries.includes(library)) spec.libraries.push(library);
    }
  }
  for (const component of spec.components) {
    if ((component.role === 'controller' && isMainBoardComponent(component)) || component.role === 'power' || isNonElectricalAccessory(component)) continue;
    const ownTopology = output.filter(connection => connection.componentId === component.id);
    const incomingTopology = incomingFor(component).filter(connection => /^(?:G|D|S|B|C|E|A|K|\+|-)$/i.test(connection.targetPin))
      .map(connection => ({ ...connection, sourcePin: connection.targetPin }));
    unresolved.push(...circuitTerminalIssues(component, [...ownTopology, ...incomingTopology]));
  }
  return { spec, unresolved: [...new Set(unresolved)] };
}

export function hardwareKnowledgeFor(text: string): string {
  return rules.filter(rule => rule.match.test(text)).map(rule => {
    const libs = rule.libraries?.length ? ` 库:${rule.libraries.join(',')};` : '';
    const headers = rule.headers?.length ? ` 头文件:${rule.headers.join(',')};` : '';
    return `${rule.name}: 接口=${rule.interface};${libs}${headers} ${rule.guidance}`;
  }).join('\n');
}

/** The recommendation UI and the wiring generator must advertise the same capabilities. */
export function supportedHardwareSummary(): string {
  return `Arduino Uno/Nano/Mega、ESP32开发板、${rules.map(rule => `${rule.name}（${rule.interface}）`).join('、')}`;
}

export function evaluateSpecHardware(spec: ProjectSpec): string[] {
  const issues: string[] = [];
  for (const component of spec.components) {
    const rule = isSupportPart(component) ? undefined : rules.find(item => item.match.test(`${component.name} ${component.model || ''}`));
    if (!rule || !component.interface) continue;
    const actual = component.interface.toLowerCase();
    const expected = rule.interface.toLowerCase();
    if (actual.includes('i2c') && !expected.includes('i2c')) issues.push(`${component.name} 被错误标为 I2C，正确接口是 ${rule.interface}`);
  }
  return issues;
}

export function evaluateHardwareCode(goal: string, code: string): string[] {
  const issues: string[] = [];
  if (/Adafruit_DHT/i.test(code)) issues.push('DHT代码使用了不存在的Adafruit_DHT接口，应使用DHT.h和DHT类');
  if (/Adafruit_MAX72XX/i.test(code)) issues.push('MAX7219代码使用了不存在的Adafruit_MAX72XX接口，应使用MD_MAX72XX');
  if (/舵机|servo/i.test(goal) && !/(#include\s*[<"]Servo\.h|\.attach\s*\(|\.write\s*\()/i.test(code)) issues.push('舵机没有使用Servo库的attach/write接口');
  if (/\bTDS\b/i.test(goal) && /(?:readTDS|readTds)[\s\S]{0,300}return\s+\d+(?:\.\d+)?\s*;/i.test(code)) issues.push('TDS读取仍是固定常数，不是真实传感器采样');
  if (/TODO|Placeholder|占位|伪代码/i.test(code)) issues.push('代码仍含TODO或占位实现');
  // A normal Arduino sketch cannot discover how VCC/GND or an external power
  // stage is physically wired, nor can it prove a component's rated current.
  // Reject generated code that turns those facts into hard-coded `true`
  // "runtime checks". Keep the match deliberately narrow so configuration
  // flags such as RELAY_ACTIVE_LOW are not mistaken for fake verification.
  const physicalVerificationName = /(?:CONN(?:ECTION)?|WIR(?:E|ING)|TOPOLOGY|COMMON_?GROUND|STALL_?CURRENT|CURRENT_?RATED|RATED_?CURRENT|VOLTAGE_?RATED|RATED_?VOLTAGE|HARDWARE(?:_\w+)?_?OK|POWER(?:_SUPPLY)?(?:_\w+)?_?OK|PSU(?:_\w+)?_?OK|MOSFET(?:_\w+)?_?OK)/i;
  const fixedTrue = /\b(?:static\s+)?const(?:expr)?\s+bool\s+([A-Za-z_]\w*)\s*=\s*true\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = fixedTrue.exec(code)) !== null) {
    if (physicalVerificationName.test(match[1])) {
      issues.push(`代码用固定 true（${match[1]}）冒充 Arduino 无法在运行时验证的实物接线或额定参数；应把它列为用户接线确认项，而不是代码安全互锁`);
    }
  }
  return issues;
}

/** Normalize board-specific pin spellings without changing boards where D-pin aliases are real. */
export function normalizeBoardPinSyntax(code: string, fqbn: string): string {
  const board = fqbn.trim().toLowerCase();
  const isClassicAvr = /^(?:arduino:avr:(?:uno|nano|mini|pro|mega|leonardo|micro))$/.test(board);
  if (!isClassicAvr) return code;
  return code.replace(/\bD(\d{1,2})\b/g, (token, digits: string) => {
    const pin = Number(digits);
    return Number.isInteger(pin) && pin >= 0 && pin <= 53 ? String(pin) : token;
  });
}
