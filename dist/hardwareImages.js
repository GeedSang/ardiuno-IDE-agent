"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.localHardwarePackMatch = localHardwarePackMatch;
exports.localHardwareImage = localHardwareImage;
const fs_1 = require("fs");
const path_1 = require("path");
const catalogCache = new Map();
const imageRules = [
    { match: /\bArduino\s+Uno\b|\bUno\s+R3\b/i, file: 'arduino-uno-r3.svg' },
    { match: /\bArduino\s+Nano\b|\bNano\s+V?3\b/i, file: 'arduino-nano-v3.svg' },
    { match: /\bArduino\s+Mega\s*2560\b|\bMega\s*2560\b/i, file: 'arduino-mega-2560.svg' },
    { match: /\bArduino\s+Leonardo\b/i, file: 'arduino-leonardo.svg' },
    { match: /\bNodeMCU\b.*\bESP8266\b|\bESP8266\b.*\bNodeMCU\b|Amica\s+NodeMCU/i, file: 'nodemcu-esp8266.svg' },
    { match: /\bUS\s*-?\s*100\b/i, file: 'us-100.svg' },
    { match: /HC\s*-?\s*SR04/i, file: 'hc-sr04.svg' },
    { match: /DS18B20/i, file: 'ds18b20.svg' },
    { match: /\bBMP\s*180\b/i, file: 'bmp180.svg' },
    { match: /\bBME\s*280\b/i, file: 'bme280-sparkfun.svg' },
    { match: /\bMPU\s*-?\s*6050\b|\bGY\s*-?\s*521\b/i, file: 'mpu6050-gy521.svg' },
    { match: /\bADXL\s*345\b/i, file: 'adxl345.svg' },
    { match: /SparkFun.*土壤|SparkFun.*soil\s*moisture|土壤.*SparkFun/i, file: 'soil-moisture-sparkfun.svg' },
    { match: /\bACS\s*712\b/i, file: 'acs712.svg' },
    { match: /\bWS2812B\b(?!.*灯带)|WS2812B\s*(?:LED|灯珠|芯片)/i, file: 'ws2812b-led.svg' },
    { match: /(?:SG90|9G).*舵机|舵机.*(?:SG90|9G)|(?:SG90|9G).*servo|servo.*(?:SG90|9G)/i, file: 'servo-9g.svg' },
    { match: /蜂鸣器|buzzer/i, file: 'buzzer.svg' },
    { match: /驻极体麦克风|electret\s+microphone/i, file: 'microphone.svg' },
    { match: /按钮|按键|push\s*button/i, file: 'push-button.svg' },
    { match: /(?:1602|16x2).*LCD|LCD.*(?:1602|16x2)/i, file: 'lcd-1602.svg' },
    { match: /Grove.*OLED|OLED.*Grove/i, file: 'grove-oled-128x96.svg' },
    { match: /(?:一位|1位|single).*七段|七段.*(?:一位|1位|single)|single.*7.?segment/i, file: 'seven-segment-single.svg' },
    { match: /光敏电阻|photoresistor|\bLDR\b/i, file: 'ldr.svg' },
    { match: /直流电机|DC\s*motor/i, file: 'dc-motor.svg' },
    { match: /双极.*步进|bipolar.*stepper/i, file: 'stepper-bipolar.svg' },
    { match: /单极.*步进|unipolar.*stepper/i, file: 'stepper-unipolar.svg' },
    { match: /\bHC\s*-?\s*05\b/i, file: 'hc-05.svg' },
    { match: /\bNRF\s*24L01\+?\b/i, file: 'nrf24l01.svg' },
    { match: /红外接收(?:器|头)|IR\s*receiver/i, file: 'ir-receiver.svg' },
    { match: /旋转编码器|rotary\s*encoder/i, file: 'rotary-encoder.svg' },
    { match: /摇杆.*模块|joystick.*breakout/i, file: 'joystick-breakout.svg' },
    { match: /旋转电位器|rotary\s*potentiometer/i, file: 'rotary-potentiometer.svg' },
    { match: /\b74HC595\b/i, file: '74hc595.svg' },
    { match: /面包板|breadboard/i, file: 'breadboard.svg' }
];
/** Returns an exact-enough local reference image. Unknown modules deliberately use the UI fallback. */
function normalizedTokens(value) {
    const stopWords = new Set(['arduino', 'sensor', 'module', 'board', 'breakout', 'shield', 'device', 'the', 'with']);
    return [...new Set(value.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim().split(/\s+/).filter(token => token && !stopWords.has(token) && (token.length >= 4 || /\d/.test(token))))];
}
function matchPackEntry(name, model, category, packPath) {
    const catalogPath = (0, path_1.join)(packPath, 'catalog.json');
    if (!(0, fs_1.existsSync)(catalogPath))
        return undefined;
    let catalog = catalogCache.get(catalogPath);
    if (!catalogCache.has(catalogPath)) {
        try {
            catalog = JSON.parse((0, fs_1.readFileSync)(catalogPath, 'utf8'));
        }
        catch {
            catalog = undefined;
        }
        catalogCache.set(catalogPath, catalog);
    }
    const tokens = normalizedTokens(`${model} ${name} ${category}`);
    const modelCompact = normalizedTokens(model).join('');
    if (!catalog?.entries?.length || !tokens.length)
        return undefined;
    const scored = catalog.entries.map(entry => {
        const searchable = `${entry.id} ${entry.title} ${(entry.tags || []).join(' ')} ${entry.family || ''}`.toLowerCase().replace(/[^a-z0-9+]+/g, ' ');
        const compact = searchable.replace(/\s+/g, '');
        const titleCompact = `${entry.title || ''}`.toLowerCase().replace(/[^a-z0-9+]+/g, '');
        const matches = tokens.filter(token => searchable.split(/\s+/).includes(token) || compact.includes(token));
        const digitMatches = matches.filter(token => /\d/.test(token)).length;
        const exactModelBonus = modelCompact.length >= 4 && compact.includes(modelCompact) ? 25 : 0;
        const exactTitleBonus = modelCompact.length >= 4 && titleCompact === modelCompact ? 12 : 0;
        return { entry, score: matches.length * 10 + digitMatches * 8 + (matches.length === tokens.length ? 4 : 0) + exactModelBonus + exactTitleBonus, matches };
    }).filter(item => item.matches.length > 0).sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best || best.score < 18 || (scored[1] && scored[1].score === best.score))
        return undefined;
    return { entry: best.entry, catalog };
}
function localHardwarePackMatch(name, model, category, packPath) {
    const match = matchPackEntry(name, model, category, packPath);
    if (!match)
        return undefined;
    return {
        title: match.entry.title,
        sourceLabel: match.entry.sourceLabel || 'Fritzing',
        sourceUrl: match.entry.sourceUrl || match.catalog.source || 'https://github.com/fritzing/fritzing-parts',
        license: match.entry.license || match.catalog.license || '许可证未知',
        connectors: match.entry.connectors || []
    };
}
function externalHardwareImage(name, model, category, packPath) {
    const match = matchPackEntry(name, model, category, packPath);
    if (!match)
        return undefined;
    const imagePath = (0, path_1.join)(packPath, 'images', match.entry.image);
    if (!(0, fs_1.existsSync)(imagePath))
        return undefined;
    return {
        dataUrl: `data:image/svg+xml;base64,${(0, fs_1.readFileSync)(imagePath).toString('base64')}`,
        sourceLabel: match.entry.title ? `${match.entry.sourceLabel || 'Fritzing'} · ${match.entry.title}` : (match.entry.sourceLabel || 'Fritzing 元件图'),
        sourceUrl: match.entry.sourceUrl || match.catalog.source || 'https://github.com/fritzing/fritzing-parts',
        license: match.entry.license || match.catalog.license || '许可证未知'
    };
}
function localHardwareImage(name, model, category, packPath) {
    const text = `${name} ${model} ${category}`;
    const rule = imageRules.find(candidate => candidate.match.test(text));
    if (rule) {
        const path = (0, path_1.join)(__dirname, '..', 'resources', 'hardware-catalog', rule.file);
        if ((0, fs_1.existsSync)(path))
            return {
                dataUrl: `data:image/svg+xml;base64,${(0, fs_1.readFileSync)(path).toString('base64')}`,
                sourceLabel: 'Fritzing 元件图', sourceUrl: 'https://github.com/fritzing/fritzing-parts', license: 'CC BY-SA 3.0'
            };
    }
    return packPath ? externalHardwareImage(name, model, category, packPath) : undefined;
}
//# sourceMappingURL=hardwareImages.js.map