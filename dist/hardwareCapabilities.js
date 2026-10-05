"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hardwareCapabilities = void 0;
exports.evaluateCapabilityConstraints = evaluateCapabilityConstraints;
exports.hardwareCapabilities = [
    { id: 'hc-sr04', name: 'HC-SR04', match: /HC-?SR04/i, interface: 'digital', signals: ['TRIG', 'ECHO'], voltage: '5V', source: 'HC-SR04 模块端子定义；不同兼容板须核对标识' },
    { id: 'dht11', name: 'DHT11', match: /DHT11/i, interface: 'one-wire', signals: ['DATA'], voltage: '3.3V-5V', library: 'DHT sensor library', source: 'DHT11 型号端子资料；裸器件与模块脚位不同' },
    { id: 'dht22', name: 'DHT22', match: /DHT22|AM2302/i, interface: 'one-wire', signals: ['DATA'], voltage: '3.3V-5V', library: 'DHT sensor library', source: 'DHT22/AM2302 型号端子资料；裸器件与模块脚位不同' },
    { id: 'ws2812', name: 'WS2812', match: /WS2812B?|NeoPixel/i, interface: 'addressable', signals: ['DIN'], voltage: '5V', library: 'Adafruit NeoPixel', source: 'WS2812 数据输入/供电定义；实际灯带电流须另行计算' },
    { id: 'tcs34725', name: 'TCS34725', match: /TCS34725/i, interface: 'i2c', signals: ['SDA', 'SCL'], fixedAddress: '0x29', library: 'Adafruit TCS34725', source: 'TCS34725 固定 I2C 地址；模块电源适配能力因板而异' },
    { id: 'apds9960', name: 'APDS-9960', match: /APDS-?9960/i, interface: 'i2c', signals: ['SDA', 'SCL'], fixedAddress: '0x39', library: 'Adafruit APDS9960 Library', source: 'APDS-9960 固定 I2C 地址；模块电源适配能力因板而异' },
    { id: 'ssd1306', name: 'SSD1306 OLED', match: /SSD1306/i, interface: 'i2c', signals: ['SDA', 'SCL'], library: 'Adafruit SSD1306', source: 'SSD1306 有 I2C/SPI 两种模块；仅当已确认 I2C 版本适用' },
    { id: 'bh1750', name: 'BH1750', match: /BH1750/i, interface: 'i2c', signals: ['SDA', 'SCL'], library: 'BH1750', source: 'BH1750 I2C 模块；地址可由 ADDR 端改变' },
    { id: 'bme280', name: 'BME280', match: /BME280/i, interface: 'i2c', signals: ['SDA', 'SCL'], source: 'BME280 有 I2C/SPI 模块；仅当已确认 I2C 版本适用' },
    { id: 'rc522', name: 'MFRC522/RC522', match: /MFRC522|\bRC522\b/i, interface: 'spi', signals: ['SCK', 'MOSI', 'MISO', 'SS', 'RST'], voltage: '3.3V', library: 'MFRC522', source: 'MFRC522 芯片与常见 RC522 模块的 3.3V 供电/接口定义' },
    { id: 'l298n', name: 'L298N', match: /L298N/i, interface: 'motor-driver', signals: ['ENA', 'IN1', 'IN2', 'OUT1', 'OUT2'], source: 'L298N 常见单通道接线；双通道还需 ENB、IN3、IN4、OUT3、OUT4' },
    { id: 'ds18b20', name: 'DS18B20', match: /DS18B20/i, interface: 'one-wire', signals: ['DATA'], voltage: '3.3V-5V', library: 'DallasTemperature', source: 'DS18B20 OneWire 总线；通常需要约 4.7kΩ 上拉' }
];
const norm = (value) => value.toUpperCase().replace(/[\s_\-]/g, '');
function evaluateCapabilityConstraints(spec) {
    const issues = [];
    const fixedAddresses = new Map();
    for (const component of spec.components) {
        if (/电阻|resistor|电容|capacitor|二极管|diode|电感|inductor|保险丝|fuse|电源|power\s*supply|适配器|adapter|电平转换|level\s*(?:shifter|converter)/i.test(`${component.name} ${component.interface || ''}`))
            continue;
        const fact = exports.hardwareCapabilities.find(item => item.match.test(`${component.name} ${component.model || ''}`));
        if (!fact)
            continue; // Unknown does not mean certified compatible.
        if (fact.interface === 'i2c' && /\bSPI\b/i.test(component.interface || ''))
            continue; // Variant requires its own datasheet.
        const own = spec.connections.filter(connection => connection.componentId === component.id);
        const pins = new Set(own.map(connection => norm(connection.sourcePin)));
        for (const signal of fact.signals) {
            const aliases = { DATA: ['DQ', 'OUT'], SS: ['SDA', 'CS'], RST: ['RESET'] };
            if (!pins.has(norm(signal)) && !(aliases[signal] || []).some(alias => pins.has(alias))) {
                issues.push(`${component.name}（${fact.name}）缺少 ${signal} 端子接线；请核对具体模块型号`);
            }
        }
        if (fact.id === 'rc522') {
            const converterPattern = /电平转换|level\s*(?:shifter|converter)/i;
            const converted = own.filter(connection => converterPattern.test(`${connection.target} ${connection.targetPin}`));
            if (converted.length) {
                const canonical = (pin) => /SDA\/SS|^(?:SS|CS)$/i.test(pin.trim()) ? 'SS' : /^(?:RESET|RST)$/i.test(pin.trim()) ? 'RST' : pin.trim().toUpperCase();
                for (const signal of ['SCK', 'MOSI', 'SS', 'RST']) {
                    const paths = own.filter(connection => canonical(connection.sourcePin) === signal);
                    if (!paths.some(connection => converterPattern.test(`${connection.target} ${connection.targetPin}`)))
                        issues.push(`${component.name} 的 ${signal} 必须完整经过已选电平转换器，不能部分直连`);
                    if (paths.some(connection => converterPattern.test(`${connection.target} ${connection.targetPin}`)) && paths.some(connection => /Arduino|开发板|主板/i.test(connection.target)))
                        issues.push(`${component.name} 的 ${signal} 同时存在直连与电平转换路径`);
                }
            }
        }
        if (fact.voltage === '3.3V' && own.some(connection => /^(?:VCC|VIN|3V3)$/i.test(connection.sourcePin) && /^(?:5V|5\.0V)$/i.test(connection.targetPin))) {
            issues.push(`${component.name}（${fact.name}）标称 3.3V，不能直接把 VCC 接到 5V`);
        }
        if (fact.fixedAddress) {
            const prior = fixedAddresses.get(fact.fixedAddress);
            if (prior)
                issues.push(`${prior} 与 ${component.name} 都使用固定 I2C 地址 ${fact.fixedAddress}，无法直接共用同一总线`);
            else
                fixedAddresses.set(fact.fixedAddress, component.name);
        }
    }
    return [...new Set(issues)];
}
//# sourceMappingURL=hardwareCapabilities.js.map