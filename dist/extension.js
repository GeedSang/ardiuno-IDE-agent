"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.start = start;
exports.activate = activate;
const plugin = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const http_1 = require("http");
const path_1 = require("path");
const os_1 = require("os");
const fflate_1 = require("fflate");
const workflow_1 = require("./workflow");
const hardwareCatalog_1 = require("./hardwareCatalog");
const libraryIndex_1 = require("./libraryIndex");
const aiResponse_1 = require("./aiResponse");
const hardwareImages_1 = require("./hardwareImages");
const modelJson_1 = require("./modelJson");
const hardwareCapabilities_1 = require("./hardwareCapabilities");
const hardwareContracts_1 = require("./hardwareContracts");
const cliRecovery_1 = require("./cliRecovery");
const componentClassification_1 = require("./componentClassification");
function cliPath() {
    const candidates = [
        (0, path_1.join)((0, path_1.dirname)(process.execPath), 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
        'D:\\编程\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe'
    ];
    return candidates.find(fs_1.existsSync) || 'arduino-cli';
}
function runCli(args, cwd, timeout = 30000) {
    return new Promise(resolve => {
        (0, child_process_1.execFile)(cliPath(), args, { timeout, cwd }, (error, stdout, stderr) => {
            const exitCode = error ? Number(error.code) || 1 : 0;
            resolve({ code: exitCode, stdout, stderr });
        });
    });
}
class ProjectAuditError extends Error {
    constructor(message, project) {
        super(message);
        this.project = project;
        this.name = 'ProjectAuditError';
    }
}
class ProjectPlanError extends Error {
    constructor(message, spec) {
        super(message);
        this.spec = spec;
        this.name = 'ProjectPlanError';
    }
}
const LEVEL_SHIFT_PLAN_RULE = '使用电平转换器时，每个通道必须同时写清HVn和LVn两侧，受保护信号只能走转换链路，禁止同一信号又直接连接开发板；SPI的SCK、MOSI、CS/SS、RST等由高电平主板输出的信号必须逐路完整转换。';
const SPI_CODE_RULE = 'SPI的SCK/MOSI/MISO由SPI库管理，禁止为了让引脚数字出现在代码中而对它们额外pinMode或digitalWrite；CS/SS和RST必须使用转换链路开发板侧的实际引脚初始化设备对象。';
function extractLockedHardware(goal) {
    const raw = goal.match(/已确认硬件JSON：([^\r\n]+)/)?.[1]?.trim();
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(item => item && typeof item === 'object').map(item => item) : [];
    }
    catch {
        return [];
    }
}
function evaluateLockedHardware(goal, spec) {
    const locked = extractLockedHardware(goal);
    if (!locked.length)
        return [];
    const issues = [];
    const selectedIds = new Set(locked.map(item => item.id));
    const allowedSafetyPart = /电阻|二极管|MOSFET|三极管|电容|电感|保险丝|电平转换|稳压|降压|升压|端子|连接线|杜邦线|面包板|电源|电池/i;
    for (const component of spec.components) {
        if (component.addedForSafety) {
            if (!allowedSafetyPart.test(`${component.name} ${component.model || ''}`))
                issues.push(`${component.name} 被错误标记为安全补充件`);
            continue;
        }
        if (!component.selectionId)
            issues.push(`${component.name} 没有标明来自哪一项已确认硬件`);
        else if (!selectedIds.has(component.selectionId))
            issues.push(`${component.name} 引用了不存在的硬件选择 ${component.selectionId}`);
    }
    if (spec.board.selectionId && !selectedIds.has(spec.board.selectionId))
        issues.push(`开发板引用了不存在的硬件选择 ${spec.board.selectionId}`);
    const referenced = new Set(spec.components.map(item => item.selectionId).filter((value) => Boolean(value)));
    if (spec.board.selectionId)
        referenced.add(spec.board.selectionId);
    for (const item of locked)
        if (!referenced.has(item.id))
            issues.push(`方案遗漏了已确认硬件：${item.name}${item.model ? ` ${item.model}` : ''}`);
    for (const item of locked) {
        const composite = /[+＋、/]|套装|组合|底盘/i.test(`${item.name} ${item.model || ''}`);
        if (composite)
            continue;
        const components = spec.components.filter(component => component.selectionId === item.id && component.role !== 'controller');
        const boardCount = spec.board.selectionId === item.id ? 1 : 0;
        const actualQuantity = boardCount || components.reduce((sum, component) => sum + Math.max(1, component.quantity || 1), 0);
        if (actualQuantity !== item.quantity)
            issues.push(`${item.name} 已确认数量为 ${item.quantity}，方案中为 ${actualQuantity}`);
    }
    return [...new Set(issues)];
}
let localAiReadyUntil = 0;
let localAiStarting;
function explicitConfigurationValue(configuration, key) {
    const inspected = configuration.inspect(key);
    return String(inspected?.workspaceFolderValue || inspected?.workspaceValue || inspected?.globalValue || '').trim();
}
function resolveModelRoles(configuration) {
    const provider = configuration.get('provider', 'ollama');
    const generic = configuration.get('model', '').trim();
    const localCodeDefault = configuration.get('codeModel', 'qwen2.5-coder:14b').trim();
    const explicitCode = explicitConfigurationValue(configuration, 'codeModel');
    const code = explicitCode || (provider === 'ollama' ? localCodeDefault : generic) || localCodeDefault;
    const planning = explicitConfigurationValue(configuration, 'planningModel') || generic || code;
    const review = explicitConfigurationValue(configuration, 'reviewModel') || generic || code;
    return { planning, code, review };
}
function isOllamaEndpoint(endpoint) {
    try {
        const url = new URL(endpoint);
        return /^(?:localhost|127\.0\.0\.1)$/i.test(url.hostname) && (url.port || '80') === '11434';
    }
    catch {
        return false;
    }
}
function ollamaExecutable() {
    const configured = plugin.workspace.getConfiguration('arduinoAgent').get('ollamaPath', '').trim();
    const candidates = [
        configured,
        process.env.OLLAMA_EXECUTABLE,
        'D:\\AI\\Ollama\\ollama.exe',
        process.env.LOCALAPPDATA ? (0, path_1.join)(process.env.LOCALAPPDATA, 'Programs', 'Ollama', 'ollama.exe') : undefined,
        process.env.ProgramFiles ? (0, path_1.join)(process.env.ProgramFiles, 'Ollama', 'ollama.exe') : undefined
    ].filter((value) => Boolean(value));
    return candidates.find(fs_1.existsSync);
}
async function ollamaIsReady(origin) {
    return new Promise(resolve => {
        const url = new URL(`${origin}/api/tags`);
        const request = (0, http_1.request)({ hostname: url.hostname, port: Number(url.port || 80), path: url.pathname, method: 'GET' }, response => {
            response.resume();
            resolve(Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 300));
        });
        request.setTimeout(1500, () => request.destroy());
        request.once('error', () => resolve(false));
        request.end();
    });
}
function requestLocalAi(endpoint, apiKey, body) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint);
        const payload = JSON.stringify(body);
        const request = (0, http_1.request)({
            hostname: url.hostname,
            port: Number(url.port || 80),
            path: `${url.pathname}${url.search}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                Authorization: `Bearer ${apiKey}`
            }
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
                status: response.statusCode || 500,
                statusText: response.statusMessage || ''
            })));
        });
        request.setTimeout(600000, () => request.destroy(new Error('AI 服务响应超时（已等待 600 秒），请缩短需求或改用更快的模型')));
        request.once('error', reject);
        request.end(payload);
    });
}
async function startOllamaAndWait(endpoint) {
    if (!isOllamaEndpoint(endpoint))
        return;
    if (Date.now() < localAiReadyUntil)
        return;
    if (localAiStarting)
        return localAiStarting;
    localAiStarting = (async () => {
        const origin = new URL(endpoint).origin;
        if (await ollamaIsReady(origin)) {
            localAiReadyUntil = Date.now() + 30000;
            return;
        }
        const executable = ollamaExecutable();
        if (!executable) {
            throw new Error('未找到 Ollama。请在 Arduino Agent 设置中填写 Ollama 路径');
        }
        await new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)(executable, ['serve'], {
                detached: true,
                windowsHide: true,
                stdio: 'ignore',
                env: { ...process.env, OLLAMA_HOST: '127.0.0.1:11434' }
            });
            child.once('error', reject);
            child.once('spawn', () => { child.unref(); resolve(); });
        });
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
            if (await ollamaIsReady(origin)) {
                localAiReadyUntil = Date.now() + 30000;
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 750));
        }
        throw new Error(`Ollama 已启动，但本地 AI 服务在 45 秒内没有就绪。请检查 ${executable}`);
    })();
    try {
        await localAiStarting;
    }
    finally {
        localAiStarting = undefined;
    }
}
async function requestAi(endpoint, apiKey, body) {
    const local = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(endpoint);
    if (local) {
        try {
            await startOllamaAndWait(endpoint);
            return await requestLocalAi(endpoint, apiKey, body);
        }
        catch (error) {
            localAiReadyUntil = 0;
            throw new Error(`无法连接本地 AI 服务 ${new URL(endpoint).origin}：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), local ? 600000 : 210000);
    try {
        const isResponses = /\/responses\/?$/i.test(endpoint);
        const source = body && typeof body === 'object' ? body : {};
        const requestBody = isResponses ? {
            ...Object.fromEntries(Object.entries(source).filter(([key]) => !['messages', 'max_tokens', 'response_format', 'temperature'].includes(key))),
            input: source.messages,
            max_output_tokens: source.max_tokens
        } : body;
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        if (!isResponses || !response.ok)
            return response;
        const data = await response.json();
        const content = data.output_text || data.output?.flatMap(item => item.content || []).map(item => item.text || '').join('') || '';
        return new Response(JSON.stringify({ choices: [{ finish_reason: data.status === 'incomplete' ? 'length' : 'stop', message: { content } }] }), { status: response.status });
    }
    catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(`AI 服务响应超时（已等待 ${local ? '600' : '210'} 秒），请缩短需求或改用更快的模型`);
        }
        throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : String(error)}`);
    }
    finally {
        clearTimeout(timeout);
    }
}
function shouldRetryAiStatus(status) {
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}
/** Retry only temporary provider/network failures. Configuration errors are returned immediately. */
async function requestAiWithRetry(endpoint, apiKey, body, attempts = 3) {
    const delays = [1000, 2500, 5000];
    let lastError;
    let lastResponse;
    const original = body && typeof body === 'object' ? body : {};
    const requestedTokens = typeof original.max_tokens === 'number' ? original.max_tokens : undefined;
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
        try {
            // A number of OpenAI-compatible gateways accept a small health-check but
            // return 502/504 when a real repair reserves an 8k output.  Retry with a
            // progressively smaller reservation instead of repeating the same doomed request.
            const tokenCaps = requestedTokens && requestedTokens > 4096
                ? [requestedTokens, Math.min(6000, Math.max(4096, Math.ceil(requestedTokens * 0.75))), 4096]
                : [];
            const attemptBody = tokenCaps.length ? { ...original, max_tokens: tokenCaps[Math.min(attempt, tokenCaps.length - 1)] } : body;
            const response = await requestAi(endpoint, apiKey, attemptBody);
            lastResponse = response;
            if (response.ok || !shouldRetryAiStatus(response.status) || attempt === attempts - 1)
                return response;
            // Consume the abandoned body so its connection can be reused.
            try {
                await response.arrayBuffer();
            }
            catch { /* ignore */ }
        }
        catch (error) {
            lastError = error;
            if (attempt === attempts - 1)
                throw error;
        }
        await new Promise(resolve => setTimeout(resolve, delays[Math.min(attempt, delays.length - 1)]));
    }
    if (lastResponse)
        return lastResponse;
    throw lastError instanceof Error ? lastError : new Error('AI 服务暂时没有响应');
}
function aiEndpoint(baseUrl) {
    const mode = plugin.workspace.getConfiguration('arduinoAgent').get('apiMode', 'chat-completions');
    return `${baseUrl.replace(/\/$/, '')}/${mode === 'responses' ? 'responses' : 'chat/completions'}`;
}
async function aiHttpError(label, response) {
    const raw = (await response.text()).trim();
    const transientMessages = {
        408: 'AI 服务响应超时', 409: 'AI 服务当前请求冲突', 425: 'AI 服务暂时无法处理请求',
        429: 'AI 服务请求过多或额度受限', 500: 'AI 服务内部异常', 502: 'AI 服务网关暂时无响应',
        503: 'AI 服务暂时不可用', 504: 'AI 服务网关响应超时'
    };
    if (transientMessages[response.status]) {
        return new Error(`${label}：${transientMessages[response.status]}（${response.status}）。Agent 已自动重试，当前需求和硬件选择不会丢失`);
    }
    let detail = raw;
    try {
        const parsed = JSON.parse(raw);
        detail = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message || parsed.message || raw;
    }
    catch { /* Keep the provider's original text. */ }
    detail = /<html|<!doctype|<body|<head/i.test(detail) ? '服务商返回了无法解析的网页错误' : detail.replace(/\s+/g, ' ').slice(0, 800);
    return new Error(`${label} (${response.status})${detail ? `：${detail}` : ''}`);
}
async function testAiService(baseUrl, apiMode, apiKey, model) {
    const endpoint = `${baseUrl.replace(/\/$/, '')}/${apiMode === 'responses' ? 'responses' : 'chat/completions'}`;
    const response = await requestAi(endpoint, apiKey, {
        model,
        temperature: 0,
        max_tokens: 320,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: '这是 Arduino 完整代码能力测试。返回 JSON 对象，code 是包含 setup() 和 loop() 的最小 Arduino 程序。' },
            { role: 'user', content: '生成一个 D13 LED 闪烁的最小完整程序，只返回 {"code":"..."}。' }
        ]
    });
    if (!response.ok)
        throw new Error(`HTTP ${response.status}：${(await response.text()).slice(0, 500)}`);
    const payload = await response.json();
    const content = (0, aiResponse_1.assistantText)(payload.choices?.[0]);
    if (!content)
        throw new Error('服务已连接，但模型没有返回文本内容');
    if (!(0, aiResponse_1.extractArduinoCode)(content))
        throw new Error('服务可以回复文本，但没有生成包含 setup() 和 loop() 的完整 Arduino 代码；请检查模型名称、输出长度或更换代码模型');
    // The former 320-token check could pass while every real repair failed at the
    // gateway. Exercise the same request shape used by repair, but keep the sample
    // deterministic and inexpensive.
    const repairContext = `当前代码：\n${'#include <Arduino.h>\nint value = 0;\n'.repeat(45)}\nvoid setup(){pinMode(13,OUTPUT);}\nvoid loop(){digitalWrite(13,HIGH);delay(100);digitalWrite(13,LOW);delay(100);}`;
    const repairResponse = await requestAiWithRetry(endpoint, apiKey, {
        model,
        temperature: 0,
        max_tokens: 6000,
        messages: [
            { role: 'system', content: '你是Arduino代码修复器。只返回完整可编译源码，必须包含setup()和loop()。' },
            { role: 'user', content: `修复并精简下面程序，保留D13闪烁功能。${repairContext}` }
        ]
    });
    if (!repairResponse.ok)
        throw await aiHttpError('连接成功，但真实代码修复能力测试失败', repairResponse);
    const repairPayload = await repairResponse.json();
    const repairedCode = (0, aiResponse_1.extractArduinoCode)((0, aiResponse_1.assistantText)(repairPayload.choices?.[0]));
    if (!repairedCode)
        throw new Error('连接成功，但长代码修复没有返回包含 setup() 和 loop() 的完整源码');
    return '连接与真实代码修复测试均通过（已验证兼容网关降级）';
}
function normalizeGeneratedProject(raw, fallbackGoal) {
    const value = (raw && typeof raw === 'object' ? raw : {});
    const text = (field, fallback = '') => {
        const rawText = value[field];
        if (rawText === undefined || rawText === null)
            return fallback;
        if (typeof rawText !== 'object')
            return String(rawText).trim();
        const names = Array.isArray(rawText)
            ? rawText.map(item => typeof item === 'object' && item ? String(item.name || JSON.stringify(item)) : String(item))
            : Object.keys(rawText);
        return names.map(name => name.trim()).filter(Boolean).join('、') || fallback;
    };
    const pins = (field) => {
        const rawPins = value[field];
        if (rawPins === undefined || rawPins === null)
            return '';
        if (typeof rawPins !== 'object')
            return String(rawPins).trim();
        if (Array.isArray(rawPins))
            return rawPins.map(item => String(item).trim()).filter(Boolean).join(', ');
        return Object.entries(rawPins)
            .map(([name, pin]) => `${name.toUpperCase()}=${String(pin).trim()}`)
            .join(', ');
    };
    const list = (field) => {
        const rawList = value[field];
        if (Array.isArray(rawList))
            return rawList.map(item => String(item).trim()).filter(Boolean);
        if (!rawList || typeof rawList !== 'object')
            return [];
        const flattened = [];
        for (const [moduleName, connection] of Object.entries(rawList)) {
            if (connection && typeof connection === 'object' && !Array.isArray(connection)) {
                for (const [pinName, target] of Object.entries(connection)) {
                    flattened.push(`${moduleName} ${pinName} -> ${String(target).trim()}`);
                }
            }
            else {
                flattened.push(`${moduleName} -> ${String(connection).trim()}`);
            }
        }
        return flattened.filter(Boolean);
    };
    const legacy = {
        goal: text('goal', fallbackGoal) || fallbackGoal,
        sensor: text('sensor', '未指定传感器'),
        output: text('output', '未指定输出模块'),
        sensorPin: pins('sensorPin'),
        outputPin: pins('outputPin'),
        wiringConfirmed: false,
        wiring: list('wiring'),
        libraries: list('libraries')
    };
    const spec = (0, workflow_1.normalizeProjectSpec)(value, { ...legacy, wiring: legacy.wiring || [], libraries: legacy.libraries || [] });
    const signalConnections = spec.connections.filter(connection => !/^(?:VCC|VIN|5V|3\.3V|GND|GROUND|\+|-)$/i.test(connection.sourcePin)
        && !/^(?:VCC|VIN|5V|3\.3V|GND|GROUND)$/i.test(connection.targetPin));
    const componentRole = (componentId, componentName) => spec.components.find(component => component.id === componentId || componentName.includes(component.name))?.role;
    const inferredSensorPins = signalConnections
        .filter(connection => componentRole(connection.componentId, connection.componentName) === 'input')
        .map(connection => connection.targetPin).filter(Boolean);
    const inferredOutputPins = signalConnections
        .filter(connection => componentRole(connection.componentId, connection.componentName) === 'output')
        .map(connection => connection.targetPin).filter(Boolean);
    const result = {
        ...legacy,
        sensorPin: legacy.sensorPin || [...new Set(inferredSensorPins)].join(', '),
        outputPin: legacy.outputPin || [...new Set(inferredOutputPins)].join(', '),
        spec,
        code: value.code === undefined || value.code === null ? '' : String(value.code).trim()
    };
    if (!result.code)
        throw new Error('模型返回内容缺少完整 Arduino 代码，Agent 将保留错误证据供重试');
    return result;
}
async function parseModelJsonWithAiRepair(content, apiKey, baseUrl, model) {
    try {
        return (0, modelJson_1.parseModelJson)(content);
    }
    catch (originalError) {
        const response = await requestAiWithRetry(aiEndpoint(baseUrl), apiKey, { model, temperature: 0, max_tokens: 4000, response_format: { type: 'json_object' }, messages: [
                { role: 'system', content: '你是JSON格式修复器。保持所有字段和值的原意，只修复缺失逗号、括号、引号或截断结构。只返回一个完整JSON对象，不解释，不使用Markdown代码块。' },
                { role: 'user', content: content.slice(0, 24000) }
            ] });
        if (!response.ok)
            throw originalError;
        const payload = await response.json();
        const repaired = (0, aiResponse_1.assistantText)(payload.choices?.[0]);
        if (!repaired)
            throw originalError;
        return (0, modelJson_1.parseModelJson)(repaired);
    }
}
function applyBehaviorPrimitives(goal, project, issues) {
    let code = project.code;
    if (issues.some(issue => /单次模拟值|峰峰值|偏差或包络/.test(issue)) && /声音|麦克风|拾音|sound|microphone/i.test(goal) && !/readAnalogPeakToPeak\s*\(/.test(code)) {
        const soundComponentIds = new Set(project.spec.components.filter(component => /声音|麦克风|sound|microphone/i.test(`${component.name} ${component.model || ''}`)).map(component => component.id));
        const soundTargets = new Set(project.spec.connections.filter(connection => soundComponentIds.has(connection.componentId) && /^A\d+$/i.test(connection.targetPin)).map(connection => connection.targetPin.toUpperCase()));
        const soundSymbols = new Set([...soundTargets]);
        for (const target of soundTargets) {
            const declaration = new RegExp(`(?:#define\\s+|(?:const\\s+)?(?:u?int(?:8|16|32)?_t|int)\\s+)([A-Za-z_]\\w*)\\s*(?:=\\s*)?${target}\\b`, 'gi');
            for (const match of code.matchAll(declaration))
                soundSymbols.add(match[1]);
        }
        const before = code;
        code = code.replace(/analogRead\s*\(\s*([A-Za-z_]\w*|A\d+)\s*\)/g, (call, pin) => soundSymbols.has(pin) || soundSymbols.has(pin.toUpperCase()) || /sound|mic|audio/i.test(pin) ? `readAnalogPeakToPeak(${pin}, 20)` : call);
        if (code !== before) {
            const helper = `\nuint16_t readAnalogPeakToPeak(uint8_t pin, unsigned long windowMs) {\n  unsigned long started = millis();\n  int minimum = 1023;\n  int maximum = 0;\n  while (millis() - started < windowMs) {\n    int sample = analogRead(pin);\n    if (sample < minimum) minimum = sample;\n    if (sample > maximum) maximum = sample;\n  }\n  return (uint16_t)(maximum - minimum);\n}\n\n`;
            const setupAt = code.search(/\bvoid\s+setup\s*\(/);
            if (setupAt >= 0)
                code = `${code.slice(0, setupAt)}${helper}${code.slice(setupAt)}`;
        }
    }
    return { ...project, code };
}
function normalizeHardwareCandidate(item, index, importance) {
    const entry = item && typeof item === 'object' ? item : {};
    const name = String(entry.name || `硬件 ${index + 1}`).trim();
    const model = String(entry.model || '').trim();
    return {
        id: String(entry.id || `hardware-${index + 1}`), name, model,
        category: String(entry.category || '其他').trim(),
        quantity: Math.max(1, Math.min(99, Number(entry.quantity) || 1)), importance,
        reason: String(entry.reason || '用于完成项目功能').trim(),
        voltage: entry.voltage ? String(entry.voltage).trim() : undefined,
        interface: entry.interface ? String(entry.interface).trim() : undefined,
        searchKeywords: String(entry.searchKeywords || `${name} ${model}`).trim(),
        bestFor: entry.bestFor ? String(entry.bestFor).trim() : undefined,
        advantages: entry.advantages ? String(entry.advantages).trim() : undefined,
        limitations: entry.limitations ? String(entry.limitations).trim() : undefined
    };
}
function normalizeHardwareRecommendation(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const rawGroups = Array.isArray(value.decisionGroups) ? value.decisionGroups : [];
    const groups = rawGroups.slice(0, 5).map((rawGroup, groupIndex) => {
        const group = rawGroup && typeof rawGroup === 'object' ? rawGroup : {};
        const options = (Array.isArray(group.options) ? group.options : []).slice(0, 3).map((item, optionIndex) => normalizeHardwareCandidate(item, groupIndex * 10 + optionIndex, 'choice'));
        return {
            id: String(group.id || `decision-${groupIndex + 1}`),
            title: String(group.title || `选择 ${groupIndex + 1}`).trim(),
            question: String(group.question || '你更希望使用哪一种？').trim(),
            why: String(group.why || '不同方案在价格、难度和效果上有所区别。').trim(),
            optional: group.optional === true,
            options
        };
    }).filter(group => group.options.length >= 1);
    const rawAccessories = Array.isArray(value.commonAccessories) ? value.commonAccessories : [];
    const commonAccessories = rawAccessories.slice(0, 8).map((item, index) => {
        const entry = item && typeof item === 'object' ? item : {};
        const importanceText = String(entry.importance || '').toLowerCase();
        const importance = importanceText === 'optional' ? 'optional' : importanceText === 'recommended' ? 'recommended' : 'required';
        return normalizeHardwareCandidate(item, 100 + index, importance);
    });
    return { groups, commonAccessories };
}
const REQUIRED_CAPABILITIES = [
    { id: 'sense', label: '数据采集/传感器', need: /监测|检测|测量|采集|感应|识别|温度|湿度|气压|距离|声音|光照|颜色|姿态|烟雾|气体|土壤|水位/i, hardware: /传感器|sensor|DHT|BME|BMP|HC-?SR04|麦克风|TCS|APDS|MPU|光敏|温度|湿度|气压/i },
    { id: 'display', label: '显示设备', need: /显示|屏幕|屏显|界面|趋势|图表/i, hardware: /显示|屏|OLED|LCD|TFT|数码管|点阵/i },
    { id: 'sound-alert', label: '声音提醒设备', need: /声音提醒|声音提示|蜂鸣|声光|鸣叫/i, hardware: /蜂鸣器|buzzer|扬声器|speaker/i },
    { id: 'light-alert', label: '灯光提醒设备', need: /灯光提醒|灯光提示|指示灯|闪灯|声光/i, hardware: /LED|灯|灯带|NeoPixel|WS281/i },
    { id: 'motion', label: '执行/运动机构', need: /抓取|移动|转动|开门|关门|机械臂|小车|传送|抽水|浇水|风扇|电机|舵机/i, hardware: /舵机|servo|电机|motor|水泵|pump|继电器|relay|驱动|L298|A4988/i }
];
function requiredCapabilitiesFor(goal) {
    return REQUIRED_CAPABILITIES.filter(capability => capability.need.test(goal));
}
function recommendationCoverageIssues(goal, recommendation) {
    const optionText = recommendation.groups.flatMap(group => group.options).map(item => `${item.name} ${item.model} ${item.category} ${item.reason}`).join(' ');
    const issues = requiredCapabilitiesFor(goal).filter(capability => !capability.hardware.test(optionText)).map(capability => `缺少“${capability.label}”硬件选择组`);
    if (requiredCapabilitiesFor(goal).length && recommendation.groups.length < 2)
        issues.push('复杂项目不能只提供开发板一个选择组');
    return [...new Set(issues)];
}
function selectedHardwareCoverageIssues(goal, selected) {
    const selectedText = selected.map(item => `${item.name} ${item.model} ${item.category} ${item.reason}`).join(' ');
    return requiredCapabilitiesFor(goal).filter(capability => !capability.hardware.test(selectedText)).map(capability => `当前硬件没有覆盖你的需求：${capability.label}`);
}
async function recommendBeginnerHardware(goal, apiKey, baseUrl, model) {
    let previousIssues = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const response = await requestAiWithRetry(aiEndpoint(baseUrl), apiKey, { model, temperature: 0, max_tokens: 3600, response_format: { type: 'json_object' }, messages: [
                { role: 'system', content: '你是中立的Arduino入门引导员，不替用户决定唯一硬件。只返回紧凑JSON：decisionGroups和commonAccessories。先把目标拆成必须实现的能力；主板、每类输入、每类输出、显示和供电分别建立决策组，不得只推荐开发板。decisionGroups为2到8个按顺序的功能决策组，每组={id,title,question,why,optional,options}；用户明确要求的功能组optional必须为false。options给1到3个真实方案，每项={id,name,model,category,quantity,reason,bestFor,advantages,limitations,voltage,interface,searchKeywords}。只能从supportedHardware能力范围选择电气设备。每个option只能是一种电气设备或一个明确型号的成套执行机构，禁止把多个独立接线设备合成一个条目。相互独立的设备必须放到不同决策组。commonAccessories只放所有方案共同需要的硬件；importance可为required/recommended/optional。危险市电改为安全低压。每段不超过30字。' },
                { role: 'user', content: JSON.stringify({ goal, requiredCapabilities: requiredCapabilitiesFor(goal).map(item => item.label), supportedHardware: (0, hardwareCatalog_1.supportedHardwareSummary)(), previousIssues }) }
            ] });
        if (!response.ok)
            throw await aiHttpError('AI 硬件推荐请求失败', response);
        const payload = await response.json();
        const content = (0, aiResponse_1.assistantText)(payload.choices?.[0]);
        if (!content) {
            previousIssues = ['硬件推荐模型没有返回内容'];
            continue;
        }
        const recommendation = normalizeHardwareRecommendation(await parseModelJsonWithAiRepair(content, apiKey, baseUrl, model));
        previousIssues = recommendationCoverageIssues(goal, recommendation);
        if (recommendation.groups.length && !previousIssues.length) {
            for (const group of recommendation.groups) {
                const optionText = group.options.map(item => `${item.name} ${item.model} ${item.category} ${item.reason}`).join(' ');
                if (requiredCapabilitiesFor(goal).some(capability => capability.hardware.test(optionText)))
                    group.optional = false;
            }
            return recommendation;
        }
    }
    throw new Error(`硬件推荐没有完整覆盖项目功能：${previousIssues.join('；')}`);
}
async function createBeginnerPlan(goal, hardware, apiKey, baseUrl, model) {
    const response = await requestAiWithRetry(aiEndpoint(baseUrl), apiKey, { model, temperature: 0, max_tokens: 3600, response_format: { type: 'json_object' }, messages: [
            { role: 'system', content: '你是Arduino项目方案整理师。根据模糊目标和已选硬件返回紧凑JSON：title,description,workflow,assumptions,safetyNotes,generationGoal。description不超过180字；workflow最多6项且每项不超过45字；assumptions和safetyNotes各最多4项。generationGoal不超过1200字，必须明确列出每个硬件的型号、数量、功能、接口约束和期望行为，足够后续代码规划器使用。不得添加未选择的主要模块，只能补充安全接线必需的小器件。不要写背景、价值、重复解释或宣传语。' },
            { role: 'user', content: JSON.stringify({ fuzzyGoal: goal, selectedHardware: hardware }) }
        ] });
    if (!response.ok)
        throw await aiHttpError('AI 详细方案请求失败', response);
    const payload = await response.json();
    const parsed = await parseModelJsonWithAiRepair((0, aiResponse_1.assistantText)(payload.choices?.[0]), apiKey, baseUrl, model);
    const list = (field) => Array.isArray(parsed[field]) ? parsed[field].map(String).map(item => item.trim()).filter(Boolean) : [];
    const generationGoal = String(parsed.generationGoal || '').trim();
    if (!generationGoal)
        throw new Error('详细方案缺少可用于生成代码的完整需求');
    return {
        title: String(parsed.title || 'Arduino 初学者项目').trim(),
        description: String(parsed.description || generationGoal).trim(),
        workflow: list('workflow'), assumptions: list('assumptions'), safetyNotes: list('safetyNotes'), generationGoal
    };
}
function taobaoHardwareSearchUrl(item) {
    return `https://s.taobao.com/search?q=${encodeURIComponent(`${item.searchKeywords} 官方旗舰店`)}`;
}
async function chooseBeginnerHardware(recommendation, previous = [], hostPanel, restoreHost) {
    return new Promise(resolve => {
        const groups = recommendation.groups.map((group, groupIndex) => {
            const previousItem = previous.find(item => group.options.some(option => option.id === item.id));
            const options = group.options.map((item, optionIndex) => {
                const checked = previousItem ? previousItem.id === item.id : optionIndex === 0;
                return `<label class="option"><input type="radio" name="group-${groupIndex}" value="${optionIndex}" ${checked ? 'checked' : ''}><div class="option-image">${hardwareImageHtml(item)}</div><span class="option-copy"><strong>${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ''} ×${item.quantity}</strong><small>${escapeHtml([item.bestFor ? `适合：${item.bestFor}` : '', item.voltage, item.interface].filter(Boolean).join(' · '))}</small><em>用途：${escapeHtml(item.reason)}</em>${item.advantages ? `<em>优点：${escapeHtml(item.advantages)}</em>` : ''}${item.limitations ? `<em>局限：${escapeHtml(item.limitations)}</em>` : ''}<button type="button" class="purchase" data-group="${groupIndex}" data-option="${optionIndex}">查看外观与淘宝搜索</button></span></label>`;
            }).join('');
            const skip = group.optional ? `<label class="option skip"><input type="radio" name="group-${groupIndex}" value="skip" ${previousItem ? '' : 'checked'}><span><strong>暂不加入这一类硬件</strong><small>以后仍可在方案中修改</small></span></label>` : '';
            return `<section class="decision"><div class="number">${groupIndex + 1}</div><div class="decision-body"><h2>${escapeHtml(group.title)}</h2><p class="question">${escapeHtml(group.question)}</p><p class="why">为什么要选：${escapeHtml(group.why)}</p><div class="options">${options}${skip}</div></div></section>`;
        }).join('');
        const ownsPanel = !hostPanel;
        const panel = hostPanel || plugin.window.createWebviewPanel('arduinoHardwareDecisions', '选择项目硬件', plugin.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{width:100%;max-width:960px;margin:auto}header{background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:20px;margin-bottom:12px}h1{font-size:22px;margin:0 0 7px}header p,.why{color:#66758a;line-height:1.6}.decision{display:grid;grid-template-columns:38px minmax(0,1fr);gap:10px;background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:17px;margin-bottom:12px;min-width:0}.decision-body,.options{min-width:0}.number{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:#168c83;color:#fff;font-weight:700}.decision h2{font-size:17px;margin:3px 0;overflow-wrap:anywhere}.question{font-weight:700;margin:7px 0 2px;line-height:1.55}.why{margin:0 0 10px}.options{display:grid;grid-template-columns:1fr;gap:10px}.option{display:grid;grid-template-columns:22px minmax(0,1fr);gap:10px;border:2px solid #dce4ee;border-radius:10px;padding:12px;cursor:pointer;align-items:start;min-width:0}.option:has(input:checked){border-color:#168c83;background:#eef9f7}.option input{margin-top:4px}.option-image{grid-column:2;position:relative;width:100%;height:188px;background:#f7fafc;border-radius:8px;overflow:hidden}.option-image svg,.option-image img{display:block;width:100%;height:160px;object-fit:contain}.image-source{position:absolute;left:8px;right:8px;bottom:5px;text-align:center;font-size:10px;line-height:1.25;color:#718096;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.option-copy{grid-column:2;min-width:0}.option-copy,.option strong,.option small,.option em{display:block}.option strong{font-size:15px;line-height:1.5;overflow-wrap:anywhere}.option small{color:#66758a;margin:4px 0;line-height:1.45;overflow-wrap:anywhere}.option em{font-size:12px;color:#526176;font-style:normal;line-height:1.55;overflow-wrap:anywhere}.purchase{display:inline-block;width:auto;max-width:100%;margin-top:10px;padding:8px 12px;background:#e8eef5;color:#245a88;white-space:normal;line-height:1.35}.skip{border-style:dashed}.skip span{grid-column:2;min-width:0}.actions{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:10px;padding:14px 0;background:#f5f7fb}.actions button{min-width:150px}button{border:0;border-radius:8px;padding:11px 16px;font-weight:700;cursor:pointer}.cancel{background:#e8eef5;color:#294158}.confirm{background:#168c83;color:#fff}@media(max-width:650px){body{padding:12px}.decision{grid-template-columns:1fr;padding:13px}.number{margin-bottom:2px}.option-image{height:164px}.option-image svg,.option-image img{height:137px}.actions{flex-direction:column-reverse}.actions button{width:100%}}
</style></head><body><main><header><h1>选择适合你的硬件</h1><p>每个选项都提供外观参考和淘宝搜索。图片用于辨认型号，不代表指定卖家或权威推荐。</p></header>${groups}<div class="actions"><button id="cancel" class="cancel">返回修改需求</button><button id="confirm" class="confirm">确认选择并整理方案</button></div></main><script>const vscode=acquireVsCodeApi();document.querySelectorAll('.purchase').forEach(button=>button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();vscode.postMessage({type:'openPurchase',group:Number(button.dataset.group),option:Number(button.dataset.option)})}));document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'cancel'});document.getElementById('confirm').onclick=()=>{const selections=${JSON.stringify(recommendation.groups.map((_, index) => index))}.map(index=>{const input=document.querySelector('input[name="group-'+index+'"]:checked');return input?input.value:null});if(selections.some(value=>value===null)){alert('请完成每一项选择');return}document.getElementById('confirm').disabled=true;document.getElementById('confirm').textContent='正在整理方案…';vscode.postMessage({type:'confirm',selections})};</script></body></html>`;
        panel.webview.html = themedAgentHtml(panel.webview.html);
        let settled = false;
        let messageDisposable;
        let disposeDisposable;
        const finish = (value, cancelled = false) => { if (settled)
            return; settled = true; messageDisposable?.dispose(); disposeDisposable?.dispose(); resolve(value); if (ownsPanel)
            panel.dispose();
        else if (cancelled)
            restoreHost?.(); };
        messageDisposable = panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'cancel')
                finish(undefined, true);
            if (message.type === 'openPurchase' && Number.isInteger(message.group) && Number.isInteger(message.option)) {
                const item = recommendation.groups[message.group]?.options[message.option];
                if (item)
                    void plugin.env.openExternal(plugin.Uri.parse(taobaoHardwareSearchUrl(item)));
            }
            if (message.type === 'confirm' && Array.isArray(message.selections)) {
                const selected = recommendation.groups.flatMap((group, index) => {
                    const value = message.selections[index];
                    if (value === 'skip')
                        return [];
                    const option = group.options[Number(value)];
                    return option ? [{ ...option, importance: group.optional ? 'optional' : 'choice' }] : [];
                });
                finish([...selected, ...recommendation.commonAccessories]);
            }
        });
        disposeDisposable = panel.onDidDispose(() => { if (!settled) {
            settled = true;
            messageDisposable?.dispose();
            resolve(undefined);
        } });
    });
}
function hardwareIllustrationSvg(item) {
    const kind = `${item.category} ${item.name} ${item.model}`;
    const accent = /电源|battery|power/i.test(kind) ? '#f59e0b' : /灯|LED|WS2812|显示|OLED/i.test(kind) ? '#8b5cf6' : /电机|舵机|泵|motor|servo/i.test(kind) ? '#ef6c35' : /主板|Arduino|ESP/i.test(kind) ? '#168c83' : '#3578e5';
    let drawing = `<rect x="48" y="36" width="204" height="128" rx="16" fill="#fff" stroke="${accent}" stroke-width="5"/><circle cx="82" cy="68" r="12" fill="${accent}"/><rect x="110" y="57" width="108" height="22" rx="7" fill="${accent}" opacity=".22"/>`;
    if (/灯带|WS2812|NeoPixel/i.test(kind))
        drawing = `<path d="M38 112 C80 45 135 175 184 88 C205 51 234 62 262 92" fill="none" stroke="#cad3df" stroke-width="18" stroke-linecap="round"/>${[52, 88, 124, 160, 196, 232].map((x, i) => `<circle cx="${x}" cy="${[91, 77, 120, 112, 76, 83][i]}" r="11" fill="${['#3b82f6', '#06b6d4', '#8b5cf6', '#ec4899', '#f97316', '#22c55e'][i]}"/>`).join('')}`;
    else if (/电机|舵机|泵|motor|servo/i.test(kind))
        drawing = `<circle cx="144" cy="100" r="58" fill="#fff" stroke="${accent}" stroke-width="6"/><circle cx="144" cy="100" r="17" fill="${accent}"/><rect x="202" y="77" width="55" height="46" rx="8" fill="${accent}" opacity=".24"/><path d="M144 42V18M144 182v-24M86 100H55M233 100h-31" stroke="${accent}" stroke-width="7" stroke-linecap="round"/>`;
    else if (/电源|battery|power/i.test(kind))
        drawing = `<rect x="63" y="45" width="174" height="112" rx="18" fill="#fff" stroke="${accent}" stroke-width="6"/><rect x="237" y="78" width="18" height="45" rx="5" fill="${accent}"/><path d="M156 59l-34 50h29l-14 40 43-57h-31z" fill="${accent}"/>`;
    else if (/主板|Arduino|ESP/i.test(kind))
        drawing = `<rect x="45" y="35" width="210" height="130" rx="18" fill="#fff" stroke="${accent}" stroke-width="6"/><rect x="63" y="70" width="51" height="60" rx="7" fill="${accent}" opacity=".28"/><rect x="139" y="65" width="68" height="48" rx="7" fill="${accent}"/><rect x="214" y="76" width="42" height="30" rx="4" fill="#cbd5e1"/>${[65, 88, 111, 134, 157, 180, 203, 226].map(x => `<circle cx="${x}" cy="48" r="5" fill="#26364a"/><circle cx="${x}" cy="151" r="5" fill="#26364a"/>`).join('')}`;
    else
        drawing += `<circle cx="150" cy="119" r="26" fill="${accent}" opacity=".8"/>${[72, 96, 120, 144, 168, 192, 216].map(x => `<circle cx="${x}" cy="177" r="5" fill="#26364a"/>`).join('')}`;
    return `<svg viewBox="0 0 300 205" role="img" aria-label="${escapeHtml(item.name)} 外观示意">${drawing}<text x="150" y="196" text-anchor="middle" font-family="Arial,Microsoft YaHei" font-size="12" fill="#66758a">外观示意 · 请按型号核对</text></svg>`;
}
function hardwareImageHtml(item) {
    const packPath = plugin.workspace.getConfiguration('arduinoAgent').get('hardwarePackPath', 'D:\\ArduinoAgentData\\hardware-packs\\fritzing-core');
    const image = (0, hardwareImages_1.localHardwareImage)(item.name, item.model, item.category, packPath);
    if (!image)
        return `${hardwareIllustrationSvg(item)}<span class="image-source">Agent 生成的通用示意 · 非具体商品</span>`;
    return `<img src="${image.dataUrl}" alt="${escapeHtml(item.name)} 元件参考图"><span class="image-source">图片来源：<a href="${image.sourceUrl}">${image.sourceLabel}</a> · 许可证：${escapeHtml(image.license)}</span>`;
}
function hardwarePurchaseGuideHtml(hardware) {
    const cards = hardware.map((item, index) => `<article class="card"><div class="image">${hardwareImageHtml(item)}</div><div class="content"><span class="tag">${item.importance === 'choice' ? '你的选择' : item.importance === 'required' ? '共同必需辅材' : item.importance === 'recommended' ? '共同推荐辅材' : '可选辅材'}</span><h2>${escapeHtml(item.name)}</h2><h3>${escapeHtml(item.model || '通用型号')} · ×${item.quantity}</h3><p>${escapeHtml(item.reason)}</p><dl><div><dt>工作电压</dt><dd>${escapeHtml(item.voltage || '购买前核对')}</dd></div><div><dt>接口</dt><dd>${escapeHtml(item.interface || '购买前核对')}</dd></div></dl><button data-index="${index}">搜索购买渠道</button></div></article>`).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;font-family:Arial,"Microsoft YaHei",sans-serif;background:#f5f7fb;color:#203047}.header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}.header h1{font-size:22px;margin:0 0 7px}.header p{margin:0;color:#66758a;line-height:1.6}.back{background:#e8eef5!important;color:#294158!important}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.card{background:#fff;border:1px solid #dce4ee;border-radius:13px;overflow:hidden}.image{position:relative;background:linear-gradient(145deg,#f8fbff,#eef5fa);padding:10px 10px 28px;min-height:226px;display:flex;align-items:center;justify-content:center}.image svg,.image img{display:block;width:100%;height:188px;object-fit:contain}.image-source{position:absolute;left:10px;right:10px;bottom:7px;text-align:center;font-size:11px;color:#718096}.image-source a{color:#3578e5}.content{padding:15px}.tag{display:inline-block;padding:3px 8px;border-radius:999px;background:#e7f7f4;color:#08776e;font-size:11px;font-weight:700}.content h2{font-size:17px;margin:9px 0 3px}.content h3{font-size:13px;color:#66758a;margin:0 0 10px}.content p{min-height:42px;line-height:1.55;color:#44536a}dl{margin:10px 0}dl div{display:flex;justify-content:space-between;border-top:1px solid #edf1f5;padding:7px 0}dt{color:#748196}dd{margin:0;text-align:right}button{border:0;border-radius:7px;background:#168c83;color:#fff;padding:9px 12px;font-weight:700;cursor:pointer}.notice{margin-top:18px;padding:13px;border-radius:9px;background:#fff7e6;color:#7a5610;line-height:1.6}</style></head><body><div class="header"><div><h1>硬件外观与购买参考</h1><p>有可靠匹配时显示开源元件图；没有匹配时明确显示通用示意，不冒充实物照片。</p></div><button class="back" id="back">返回硬件确认</button></div><div class="grid">${cards}</div><div class="notice">图片用于识别硬件外观，不代表具体卖家商品。购买前仍需核对型号、工作电压、接口和数量；Agent 不会自动下单。</div><script>const vscode=acquireVsCodeApi();document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.id==='back')vscode.postMessage({type:'close'});else if(button.dataset.index!==undefined)vscode.postMessage({type:'openPurchase',index:Number(button.dataset.index)})});</script></body></html>`;
}
async function showHardwarePurchaseGuide(hardware) {
    await new Promise(resolve => {
        const panel = plugin.window.createWebviewPanel('arduinoHardwareGuide', '硬件外观与购买参考', plugin.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        panel.webview.html = themedAgentHtml(hardwarePurchaseGuideHtml(hardware));
        panel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'close')
                panel.dispose();
            if (message.type === 'openPurchase' && Number.isInteger(message.index) && hardware[message.index]) {
                await plugin.env.openExternal(plugin.Uri.parse(taobaoHardwareSearchUrl(hardware[message.index])));
            }
        });
        panel.onDidDispose(() => resolve());
    });
}
async function editBeginnerPlanTemporarily(plan, hardware) {
    return new Promise(resolve => {
        const panel = plugin.window.createWebviewPanel('arduinoTemporaryPlanEditor', '临时修改当前方案', plugin.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        const hardwareRows = hardware.map((item, index) => `<label class="hardware"><input type="checkbox" data-hardware="${index}" checked><span><b>${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ''}</b><small>×${item.quantity}　${escapeHtml(item.reason)}</small></span></label>`).join('');
        panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:920px;margin:auto;background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:22px}h1{font-size:22px;margin:0 0 7px}p{color:#66758a;line-height:1.6;margin:0 0 18px}.notice{padding:11px 13px;border-radius:8px;background:#fff7e6;color:#76530d;margin-bottom:16px}label.field{display:block;font-weight:700;margin:15px 0 6px}input[type=text],textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;color:#203047;background:#fff}textarea{min-height:92px;resize:vertical;line-height:1.55}#generationGoal{min-height:180px}.hardware-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px}.hardware{display:flex;gap:9px;padding:10px;border:1px solid #dce4ee;border-radius:8px;align-items:flex-start}.hardware input{margin-top:3px}.hardware span{display:flex;flex-direction:column;gap:3px}.hardware small{font-weight:400;color:#66758a}.actions{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:14px;background:#fff;border-top:1px solid #e5e7eb}button{border:0;border-radius:8px;padding:10px 15px;font-weight:700;cursor:pointer}.cancel{background:#e8eef5;color:#294158}.save{background:#168c83;color:#fff}button:disabled{opacity:.65;cursor:wait}</style></head><body><main><h1>临时修改当前方案</h1><p>这里的修改只影响这一次项目，不会改动硬件库、AI 设置或以后创建的方案。</p><div class="notice">取消勾选硬件后，请同时从“代码生成要求”中删除对应功能。涉及供电、共地和驱动保护的安全要求建议保留。</div><label class="field">本次保留的硬件</label><div class="hardware-list">${hardwareRows}</div><label class="field" for="title">方案名称</label><input id="title" type="text" value="${escapeHtml(plan.title)}"><label class="field" for="description">方案描述</label><textarea id="description">${escapeHtml(plan.description)}</textarea><label class="field" for="workflow">工作流程（每行一步，可直接删除）</label><textarea id="workflow">${escapeHtml(plan.workflow.join('\n'))}</textarea><label class="field" for="assumptions">采用的默认值（每行一项）</label><textarea id="assumptions">${escapeHtml(plan.assumptions.join('\n'))}</textarea><label class="field" for="safetyNotes">安全提醒（每行一项）</label><textarea id="safetyNotes">${escapeHtml(plan.safetyNotes.join('\n'))}</textarea><label class="field" for="generationGoal">代码生成要求</label><textarea id="generationGoal">${escapeHtml(plan.generationGoal)}</textarea><div class="actions"><button class="cancel" id="cancel">取消修改</button><button class="save" id="save">保存临时修改并返回确认</button></div></main><script>const vscode=acquireVsCodeApi();const byId=id=>document.getElementById(id);const lines=id=>byId(id).value.split(String.fromCharCode(10)).map(x=>x.replace(String.fromCharCode(13),'').trim()).filter(Boolean);byId('cancel').addEventListener('click',()=>vscode.postMessage({type:'cancel'}));byId('save').addEventListener('click',()=>{const title=byId('title').value.trim(),description=byId('description').value.trim(),generationGoal=byId('generationGoal').value.trim();if(!title||!description||!generationGoal){alert('方案名称、描述和代码生成要求不能留空');return}const button=byId('save');button.disabled=true;button.textContent='正在保存…';vscode.postMessage({type:'save',hardwareIndexes:[...document.querySelectorAll('[data-hardware]:checked')].map(x=>Number(x.dataset.hardware)),plan:{title,description,workflow:lines('workflow'),assumptions:lines('assumptions'),safetyNotes:lines('safetyNotes'),generationGoal}})});</script></body></html>`;
        panel.webview.html = themedAgentHtml(panel.webview.html);
        let settled = false;
        const finish = (value) => { if (settled)
            return; settled = true; resolve(value); panel.dispose(); };
        panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'cancel')
                finish();
            if (message.type === 'save' && message.plan && Array.isArray(message.hardwareIndexes)) {
                const retained = message.hardwareIndexes.filter((index) => Number.isInteger(index) && Number(index) >= 0 && Number(index) < hardware.length).map((index) => hardware[index]);
                if (!retained.length) {
                    void plugin.window.showWarningMessage('至少需要保留一种硬件；如果要完全重做，请返回修改硬件。');
                    return;
                }
                const edited = message.plan;
                finish({ plan: { title: String(edited.title), description: String(edited.description), workflow: Array.isArray(edited.workflow) ? edited.workflow.map(String) : [], assumptions: Array.isArray(edited.assumptions) ? edited.assumptions.map(String) : [], safetyNotes: Array.isArray(edited.safetyNotes) ? edited.safetyNotes.map(String) : [], generationGoal: String(edited.generationGoal) }, hardware: retained });
            }
        });
        panel.onDidDispose(() => { if (!settled) {
            settled = true;
            resolve(undefined);
        } });
    });
}
async function editBeginnerPlanWithDependencies(plan, hardware, originalGoal, initialReview = false, hostPanel, restoreHost) {
    return new Promise(resolve => {
        const pageTitle = initialReview ? '确认所需硬件与方案' : '修改硬件与方案';
        const ownsPanel = !hostPanel;
        const panel = hostPanel || plugin.window.createWebviewPanel('arduinoDependentPlanEditor', pageTitle, plugin.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        const status = (item) => {
            if (/Arduino|ESP32|开发板|控制器|主板/i.test(`${item.name} ${item.model} ${item.category}`))
                return { label: '基础控制器', css: 'required', source: '负责运行程序，本身不能完成项目' };
            if (item.importance === 'choice')
                return { label: '核心选择', css: 'required', source: '根据你的目标选定' };
            if (item.importance === 'required')
                return { label: '必须保留', css: 'required', source: '供电、接线或安全必需' };
            if (item.importance === 'recommended')
                return { label: '建议保留', css: 'recommended', source: 'Agent 建议，可取消' };
            return { label: '可以没有', css: 'optional', source: '不影响核心功能' };
        };
        const hardwareRows = hardware.map((item, index) => {
            const badge = status(item);
            return `<label class="hardware ${badge.css}"><input type="checkbox" data-hardware="${index}" checked><span class="hardware-copy"><span class="badges"><b class="badge">${badge.label}</b><i>${escapeHtml(badge.source)}</i></span><strong>${escapeHtml(item.name)}${item.model ? ` · ${escapeHtml(item.model)}` : ''}</strong><small>×${item.quantity}　${escapeHtml(item.reason)}</small></span></label>`;
        }).join('');
        panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:960px;margin:auto;background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:22px}h1{font-size:22px;margin:0 0 7px}p{color:#66758a;line-height:1.6}.goal{padding:13px 15px;border-left:5px solid #3578e5;background:#eef6ff;border-radius:8px;margin:16px 0}.goal b{display:block;color:#245fae;margin-bottom:5px}.legend{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.legend span,.badge{padding:3px 8px;border-radius:999px;font-size:12px}.legend .r,.required .badge{background:#ffe9e7;color:#b42318}.legend .m,.recommended .badge{background:#fff2cc;color:#8a5a00}.legend .o,.optional .badge{background:#e8f5ec;color:#287a43}.hardware-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:9px}.hardware{display:flex;gap:10px;padding:12px;border:2px solid #dce4ee;border-radius:10px;align-items:flex-start;transition:.2s}.hardware.required{border-color:#f3aaa4;background:#fffafa}.hardware.recommended{border-color:#efd37f;background:#fffdf6}.hardware.optional{border-color:#a9d9b8;background:#f8fff9}.hardware:has(input:not(:checked)){opacity:.45;filter:grayscale(.45)}.hardware input{margin-top:5px}.hardware-copy{display:flex;flex-direction:column;gap:4px}.badges{display:flex;align-items:center;gap:7px}.badges i{font-size:11px;color:#718096;font-style:normal}.hardware small{color:#66758a}.notice{padding:11px 13px;border-radius:8px;background:#edf7f6;color:#17675f;margin:15px 0}.notice.changed{background:#fff2cc;color:#7a5200;font-weight:700}.plan-fields.stale{opacity:.45;pointer-events:none}label.field{display:block;font-weight:700;margin:15px 0 6px}input[type=text],textarea{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;color:#203047;background:#fff}textarea{min-height:90px;resize:vertical;line-height:1.55}#generationGoal{min-height:170px}.actions{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:14px;background:#fff;border-top:1px solid #e5e7eb}button{border:0;border-radius:8px;padding:10px 15px;font-weight:700;cursor:pointer}.cancel{background:#e8eef5;color:#294158}.save{background:#168c83;color:#fff}button:disabled{opacity:.65;cursor:wait}
</style></head><body><main><h1>${pageTitle}</h1><div class="goal"><b>你最初描述的需求</b>${escapeHtml(originalGoal)}</div><div class="legend"><span class="r">核心/必须</span><span class="m">建议，可取消</span><span class="o">可选，可以没有</span></div><label class="field">硬件清单</label><div class="hardware-list">${hardwareRows}</div><div class="notice" id="dependencyNotice">方案描述、工作流程和安全提醒与当前硬件一致。</div><div class="plan-fields" id="planFields"><label class="field">方案名称</label><input id="title" type="text" value="${escapeHtml(plan.title)}"><label class="field">方案描述</label><textarea id="description">${escapeHtml(plan.description)}</textarea><label class="field">工作流程（每行一步）</label><textarea id="workflow">${escapeHtml(plan.workflow.join('\n'))}</textarea><label class="field">采用的默认值（每行一项）</label><textarea id="assumptions">${escapeHtml(plan.assumptions.join('\n'))}</textarea><label class="field">安全提醒（每行一项）</label><textarea id="safetyNotes">${escapeHtml(plan.safetyNotes.join('\n'))}</textarea><label class="field">代码生成要求</label><textarea id="generationGoal">${escapeHtml(plan.generationGoal)}</textarea></div><div class="actions"><button class="cancel" id="cancel">${initialReview ? '返回项目描述' : '取消修改'}</button><button class="cancel" id="undo" hidden>撤销本页修改</button><button class="save" id="save">${initialReview ? '确认并生成代码' : '保存修改'}</button></div></main><script>
const vscode=acquireVsCodeApi(),byId=id=>document.getElementById(id),boxes=[...document.querySelectorAll('[data-hardware]')],fieldIds=['title','description','workflow','assumptions','safetyNotes','generationGoal'],unchangedSaveLabel=byId('save').textContent;
const initial=Object.fromEntries(fieldIds.map(id=>[id,byId(id).value]));let hardwareChanged=false;
const lines=id=>byId(id).value.split(String.fromCharCode(10)).map(x=>x.replace(String.fromCharCode(13),'').trim()).filter(Boolean);
const refreshDirty=()=>{hardwareChanged=boxes.some(box=>!box.checked);const dirty=hardwareChanged||fieldIds.some(id=>byId(id).value!==initial[id]);byId('undo').hidden=!dirty;byId('planFields').classList.remove('stale');byId('dependencyNotice').classList.toggle('changed',hardwareChanged);byId('dependencyNotice').textContent=hardwareChanged?'硬件已改变：仍可继续编辑；保存时 Agent 会按当前选择重新整理相关内容。':'方案描述、工作流程和安全提醒与当前硬件一致。';byId('save').textContent=hardwareChanged?'保存并重新整理方案':unchangedSaveLabel};
boxes.forEach(box=>box.addEventListener('change',refreshDirty));fieldIds.forEach(id=>byId(id).addEventListener('input',refreshDirty));
byId('undo').addEventListener('click',()=>{boxes.forEach(box=>box.checked=true);fieldIds.forEach(id=>byId(id).value=initial[id]);refreshDirty()});
byId('cancel').addEventListener('click',()=>vscode.postMessage({type:'cancel'}));
byId('save').addEventListener('click',()=>{const indexes=boxes.filter(box=>box.checked).map(x=>Number(x.dataset.hardware));if(!indexes.length){alert('至少保留一种硬件');return}const title=byId('title').value.trim(),description=byId('description').value.trim(),generationGoal=byId('generationGoal').value.trim();if(!title||!description||!generationGoal){alert('方案名称、描述和代码生成要求不能留空');return}const button=byId('save');button.disabled=true;button.textContent=hardwareChanged?'正在重新整理…':'正在保存…';vscode.postMessage({type:'save',hardwareIndexes:indexes,hardwareChanged,plan:{title,description,workflow:lines('workflow'),assumptions:lines('assumptions'),safetyNotes:lines('safetyNotes'),generationGoal}})});
</script></body></html>`;
        panel.webview.html = themedAgentHtml(panel.webview.html);
        let settled = false;
        let messageDisposable;
        let disposeDisposable;
        const finish = (value, cancelled = false) => { if (settled)
            return; settled = true; messageDisposable?.dispose(); disposeDisposable?.dispose(); resolve(value); if (ownsPanel)
            panel.dispose();
        else if (cancelled)
            restoreHost?.(); };
        messageDisposable = panel.webview.onDidReceiveMessage(message => {
            if (message.type === 'cancel')
                finish(undefined, true);
            if (message.type === 'save' && message.plan && Array.isArray(message.hardwareIndexes)) {
                const retained = message.hardwareIndexes.filter((index) => Number.isInteger(index) && Number(index) >= 0 && Number(index) < hardware.length).map((index) => hardware[index]);
                if (!retained.length) {
                    void plugin.window.showWarningMessage('至少需要保留一种硬件。');
                    return;
                }
                const edited = message.plan;
                finish({ hardware: retained, hardwareChanged: message.hardwareChanged === true, plan: { title: String(edited.title), description: String(edited.description), workflow: Array.isArray(edited.workflow) ? edited.workflow.map(String) : [], assumptions: Array.isArray(edited.assumptions) ? edited.assumptions.map(String) : [], safetyNotes: Array.isArray(edited.safetyNotes) ? edited.safetyNotes.map(String) : [], generationGoal: String(edited.generationGoal) } });
            }
        });
        disposeDisposable = panel.onDidDispose(() => { if (!settled) {
            settled = true;
            messageDisposable?.dispose();
            resolve(undefined);
        } });
    });
}
async function beginnerRequirementWizard(fuzzyGoal, apiKey, baseUrl, model, context, hostPanel, restoreHost) {
    const recommendation = await plugin.window.withProgress({ location: plugin.ProgressLocation.Notification, title: 'Agent 正在分析可行路径与替代硬件', cancellable: false }, () => recommendBeginnerHardware(fuzzyGoal, apiKey, baseUrl, model));
    const saved = context.workspaceState.get('beginnerHardwareDraft');
    let selected = saved?.goal === fuzzyGoal && Array.isArray(saved.selected) ? saved.selected : [];
    hardwareSelection: while (true) {
        const chosen = await chooseBeginnerHardware(recommendation, selected, hostPanel, restoreHost);
        if (!chosen)
            return undefined;
        const coverageIssues = selectedHardwareCoverageIssues(fuzzyGoal, chosen);
        if (coverageIssues.length) {
            await plugin.window.showWarningMessage(`当前选择还不能完成项目：${coverageIssues.join('；')}。请补全对应硬件。`);
            selected = chosen;
            continue;
        }
        selected = chosen;
        await context.workspaceState.update('beginnerHardwareDraft', { goal: fuzzyGoal, selected });
        let plan = await plugin.window.withProgress({ location: plugin.ProgressLocation.Notification, title: 'Agent 正在整理所需硬件与完整方案', cancellable: false }, () => createBeginnerPlan(fuzzyGoal, selected, apiKey, baseUrl, model));
        while (true) {
            const reviewed = await editBeginnerPlanWithDependencies(plan, selected, fuzzyGoal, true, hostPanel, restoreHost);
            if (!reviewed)
                return undefined;
            selected = reviewed.hardware;
            await context.workspaceState.update('beginnerHardwareDraft', { goal: fuzzyGoal, selected });
            const reviewedCoverage = selectedHardwareCoverageIssues(fuzzyGoal, selected);
            if (reviewedCoverage.length) {
                await plugin.window.showWarningMessage(`取消后无法完成：${reviewedCoverage.join('；')}。请保留相应核心硬件，或返回修改原始需求。`);
                continue;
            }
            if (reviewed.hardwareChanged) {
                plan = await plugin.window.withProgress({ location: plugin.ProgressLocation.Notification, title: '硬件已改变，Agent 正在同步更新完整方案', cancellable: false }, () => createBeginnerPlan(fuzzyGoal, selected, apiKey, baseUrl, model));
                continue;
            }
            plan = reviewed.plan;
            break;
        }
        const selectedText = selected.map(item => `${item.name}${item.model ? ` ${item.model}` : ''}×${item.quantity}`).join('、');
        const compactPlan = plan.generationGoal.slice(0, 1600);
        const lockedHardware = selected.map(item => ({ id: item.id, name: item.name, model: item.model, quantity: item.quantity, voltage: item.voltage, interface: item.interface }));
        return `原始目标：${fuzzyGoal.slice(0, 500)}\n已确认硬件：${selectedText}\n已确认硬件JSON：${JSON.stringify(lockedHardware)}\n执行要求：${compactPlan}`;
    }
}
async function generateProject(goal, apiKey, baseUrl, planningModel, codeModel, recoveryHint = '') {
    const endpoint = aiEndpoint(baseUrl);
    const packPath = plugin.workspace.getConfiguration('arduinoAgent').get('hardwarePackPath', 'D:\\ArduinoAgentData\\hardware-packs\\fritzing-core');
    const lockedModels = [...goal.matchAll(/"(?:name|model)"\s*:\s*"([^"]+)"/g)].map(match => match[1]);
    let packKnowledge = lockedModels.map(value => (0, hardwareImages_1.localHardwarePackMatch)(value, value, '', packPath)).filter((match) => Boolean(match && match.connectors.length)).map(match => `[Fritzing辅助端子，不能覆盖官方契约] ${match.title}；端子=${match.connectors.map(connector => connector.name || connector.id).filter(Boolean).join('/')}；来源=${match.sourceUrl}；许可证=${match.license}`).join('\n');
    const baseHardwareKnowledge = [(0, hardwareCatalog_1.hardwareKnowledgeFor)(goal), (0, hardwareContracts_1.verifiedContractKnowledge)(goal)].filter(Boolean).join('\n');
    const planningGoal = goal.length <= 3500 ? goal : `${goal.slice(0, 2600)}\n[中间的重复说明已压缩]\n${goal.slice(-700)}`;
    const planPrompt = '你是 Arduino 硬件方案规划器。禁止生成代码，只返回紧凑JSON：goal,board,components,connections,libraries,behaviors,acceptance,risks。goal不超过100字。board={name,fqbn,voltage,selectionId,confirmed:false}。components每项={id,name,model,role,interface,voltage,quantity,selectionId,addedForSafety}，role只能是input/output/controller/power/other。connections每项={componentId,componentName,sourcePin,target,targetPin,signalType,voltage,required:true}。libraries只能是库管理器中的字符串名称数组。需求中的“已确认硬件JSON”是锁定清单：board和每个非补充component必须用selectionId标明来源；组合套件拆出的多个内部部件沿用同一个selectionId。不得删除、替换或增加主要硬件。只有电阻、二极管、MOSFET、电平转换、稳压等安全必需小器件可以不设selectionId，但必须addedForSafety=true。先区分电气元件和机械辅材：传感器、执行器、显示器和供电器件需要真实接线；杜邦线、跳线、面包板、防水盒、隔水板、水箱、花盆、水管、外壳、支架、螺丝等只列入components且role=other、interface=机械辅材/无需接线，绝对禁止为它们编造VCC、GND或信号端子。connections必须描述完整电路拓扑，不限于接Arduino：水泵、电机、普通灯条等负载应经MOSFET/继电器/驱动器接外部电源；续流二极管要写A/K跨接位置；栅极电阻、下拉电阻等分立元件要写两端分别接到哪里。使用带板载续流保护的成品电机驱动模块时，不要另增无法逐只标注A/K的二极管阵列。普通两线灯带只有正负极，只有WS2811/WS2812/SK6812/NeoPixel等可寻址灯带才有DIN和代码库。RFID、LCD、OLED等名称若可能对应多种接口，必须依据明确型号或用户指定的I2C/SPI/UART接口生成，禁止凭大类名称猜接口；信息不足时不要虚构端子。每个需要接线的component至少出现一条connection；每个有源模块包含电源、地和全部信号。大电流负载写外部电源与共地；I2C可共享SDA/SCL；SPI可共享SCK/MOSI/MISO但每个设备必须有独立CS。behaviors、acceptance、risks每项只写必要短句，禁止背景说明和重复解释。acceptance的evidence只能是code/compile/upload/user。尊重用户明确硬件、引脚和数量，不增加无关模块。未指定主板时检查引脚、定时器和SRAM：Uno仅2048字节，WS2812约3字节/灯，SSD1306缓冲约1024字节；不足则选Mega等真实板型。整个JSON应尽量控制在3500 tokens内，同时保留全部电气接线。';
    let spec;
    let planIssues = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const response = await requestAiWithRetry(endpoint, apiKey, { model: planningModel, temperature: 0, max_tokens: 12000, response_format: { type: 'json_object' }, messages: [
                { role: 'system', content: `${planPrompt}\n${LEVEL_SHIFT_PLAN_RULE}` },
                { role: 'user', content: attempt === 0 ? `${planningGoal}\n\n真实硬件约束：\n${[baseHardwareKnowledge, packKnowledge].filter(Boolean).join('\n') || '采用真实Arduino库与数据手册。'}${recoveryHint ? `\n\n上一轮完整生成失败，必须主动修正且不要重复：${recoveryHint.slice(0, 1800)}` : ''}` : `需求：${planningGoal}\n硬件约束：${[baseHardwareKnowledge, packKnowledge].filter(Boolean).join('\n')}\n上次问题：${planIssues.join('；')}\n请用最短字段重新返回完整方案JSON，不要代码。` }
            ]
        });
        if (!response.ok)
            throw await aiHttpError('AI 方案请求失败', response);
        const payload = await response.json();
        const choice = payload.choices?.[0];
        const content = choice?.message?.content;
        if (choice?.finish_reason === 'length') {
            planIssues = ['硬件方案输出达到长度上限，请压缩字段内容但保留全部元件和接线'];
            continue;
        }
        if (!content) {
            planIssues = ['模型没有返回硬件方案'];
            continue;
        }
        try {
            const raw = (0, modelJson_1.parseModelJson)(content);
            const rawLibraries = (0, workflow_1.normalizeLibraryNames)(raw.libraries);
            const resolved = (0, hardwareCatalog_1.resolveHardwareConnections)((0, workflow_1.normalizeProjectSpec)(raw, { goal, sensor: '输入模块', output: '输出模块', sensorPin: '', outputPin: '', wiring: [], libraries: rawLibraries }));
            spec = resolved.spec;
            packKnowledge = spec.components.map(component => (0, hardwareImages_1.localHardwarePackMatch)(component.name, component.model || '', component.interface || '', packPath)).filter((match) => Boolean(match && match.connectors.length)).map(match => `[Fritzing辅助端子，不能覆盖官方契约] ${match.title}；端子=${match.connectors.map(connector => connector.name || connector.id).filter(Boolean).join('/')}；来源=${match.sourceUrl}；许可证=${match.license}`).join('\n');
            planIssues = [...resolved.unresolved, ...(0, workflow_1.evaluateProjectSpec)(spec), ...(0, hardwareCatalog_1.evaluateSpecHardware)(spec), ...(0, hardwareCapabilities_1.evaluateCapabilityConstraints)(spec), ...evaluateLockedHardware(goal, spec), ...evaluateProvenanceTerminals(spec, packPath)];
            if (!planIssues.length)
                break;
        }
        catch (error) {
            planIssues = [error instanceof Error ? error.message : String(error)];
        }
    }
    if (!spec)
        throw new Error(`硬件方案连续三次无法解析：${planIssues.join('；')}`);
    // 接线属于安全门禁，不能把校验失败降级为“风险”后继续生成代码。
    if (planIssues.length)
        throw new ProjectPlanError(`硬件方案连续三次未通过接线校验：${planIssues.join('；')}`, spec);
    let implementationPlan = { behaviors: spec.behaviors };
    try {
        const planResponse = await requestAiWithRetry(endpoint, apiKey, { model: codeModel, temperature: 0, max_tokens: 2600, response_format: { type: 'json_object' }, messages: [
                { role: 'system', content: '你是嵌入式行为架构师，只返回JSON。把每项需求拆成可执行结构：inputs（如何真实采样和处理）、state（需要跨loop保存的状态）、tasks（每个任务的周期和触发条件）、outputs（如何实际驱动硬件）、behaviorMapping（每项原始行为由哪些函数和状态完成）、diagnostics（串口应输出什么）。禁止生成代码，禁止遗漏任何behavior。' },
                { role: 'user', content: JSON.stringify({ originalRequirement: goal, projectSpec: spec }) }
            ] });
        if (planResponse.ok) {
            const payload = await planResponse.json();
            implementationPlan = (0, modelJson_1.parseModelJson)(payload.choices?.[0]?.message?.content || '');
        }
    }
    catch {
        // 代码阶段仍会收到完整 spec，行为计划失败不改变已验证硬件。
    }
    const codePrompt = '你是 Arduino C++ 固件工程师。硬件方案已经锁定。直接返回完整、可编译的单文件.ino源码，不要JSON、Markdown代码围栏、解释、TODO、省略或伪代码。必须包含全部#include、常量、对象、状态变量、辅助函数、setup()和loop()。逐项实现behaviors与用户参数，严格使用connections中的引脚和libraries中的真实API。禁止声明、初始化或调用projectSpec中不存在的传感器和执行器；没有蜂鸣器就禁止tone/noTone，没有额外超声波就禁止增加第二个ECHO。每个标准硬件端子只能对应connections中给出的唯一引脚。所有常量、类型和数组先声明后使用；集合使用有类型的const数组，禁止用#define定义花括号列表。代码应紧凑，避免重复注释，确保在输出上限内完整结束。非阻塞任务优先millis；输入做必要的滤波或防抖；大项目注意动态SRAM；输出串口诊断数据。声音强度必须用采样窗口峰峰值、绝对偏差或包络计算，禁止把一次analogRead原值直接当音量。流水、滚动或拖尾效果必须保存逐灯历史并移动颜色位置，禁止仅给所有灯重复填充同一颜色。常用库约束：MAX7219点阵使用MD_MAX72XX和MD_MAX72xx.h，不存在Adafruit_MAX72XX；NicoHood MSGEQ7库使用CMSGEQ7模板类、begin/read/get接口。';
    let code = '';
    let partialCode = '';
    const codeFailures = [];
    for (let attempt = 0; attempt < 6; attempt++) {
        const continuation = partialCode
            ? `上一段源码因服务商输出上限被截断。请从断点后继续，只返回尚未输出的源码，不要从#include或setup重新开始。上一段末尾如下：\n${partialCode.slice(-3000)}`
            : undefined;
        const response = await requestAiWithRetry(endpoint, apiKey, { model: codeModel, temperature: 0, max_tokens: 8000, messages: [
                { role: 'system', content: `${codePrompt}\n${SPI_CODE_RULE}` },
                { role: 'user', content: continuation || JSON.stringify({ originalRequirement: goal, verifiedHardwareKnowledge: [baseHardwareKnowledge, packKnowledge].filter(Boolean).join('\n'), projectSpec: spec, implementationPlan }) }
            ] });
        if (!response.ok)
            throw await aiHttpError('AI 编码请求失败', response);
        const payload = await response.json();
        const choice = payload.choices?.[0];
        const content = (0, aiResponse_1.assistantText)(choice);
        if (content)
            partialCode = (0, aiResponse_1.mergeCodeContinuation)(partialCode, content);
        const candidate = (0, aiResponse_1.extractArduinoCode)(partialCode) || (0, aiResponse_1.extractArduinoCode)(content);
        if (candidate) {
            code = candidate;
            break;
        }
        codeFailures.push(!choice ? '服务响应中没有 choices[0]' : !content ? '模型返回的正文为空' : choice.finish_reason === 'length' ? `第${attempt + 1}段达到长度上限，已自动请求续写` : `第${attempt + 1}段未形成完整 setup()/loop()（${content.length} 字符）`);
    }
    if (!code)
        throw new Error(`编码阶段自动续写后仍未得到完整 Arduino 代码：${codeFailures.join('；')}。该服务的单次输出限制过低，建议选择输出额度更高的代码模型`);
    code = (0, hardwareCatalog_1.normalizeBoardPinSyntax)(code, spec.board.fqbn);
    const roleOf = (componentId, componentName) => spec.components.find(component => component.id.toLowerCase() === componentId.toLowerCase() || componentName.includes(component.name) || component.name.includes(componentName))?.role;
    const signalConnections = spec.connections.filter(connection => !/^(?:VCC|VIN|5V|3\.3V|GND|GROUND|\+|-)$/i.test(connection.sourcePin) && !/^(?:VCC|VIN|5V|3\.3V|GND|GROUND)$/i.test(connection.targetPin));
    const sensorPins = signalConnections.filter(connection => roleOf(connection.componentId, connection.componentName) === 'input').map(connection => connection.targetPin);
    const outputPins = signalConnections.filter(connection => roleOf(connection.componentId, connection.componentName) === 'output').map(connection => connection.targetPin);
    return {
        goal, code, spec, wiringConfirmed: false,
        sensor: spec.components.filter(component => component.role === 'input').map(component => component.name).join('、') || '未指定输入模块',
        output: spec.components.filter(component => component.role === 'output').map(component => component.name).join('、') || '未指定输出模块',
        sensorPin: [...new Set(sensorPins)].join(', '), outputPin: [...new Set(outputPins)].join(', '),
        wiring: spec.connections.map(connection => `${connection.componentName} ${connection.sourcePin} -> ${connection.target} ${connection.targetPin}`),
        libraries: spec.libraries
    };
}
/** Shared audited generation path used by the interactive product flow. */
async function generateAuditedProject(goal, apiKey, baseUrl, models, onPhase = () => { }) {
    let result;
    let recoveryHint = '';
    for (let recoveryAttempt = 0; recoveryAttempt < 3; recoveryAttempt++) {
        try {
            onPhase('规划硬件、接线并生成完整代码');
            result = await generateProject(goal, apiKey, baseUrl, models.planning, models.code, recoveryHint);
            break;
        }
        catch (error) {
            const failure = error instanceof Error ? error.message : String(error);
            const recoverable = /硬件方案|接线校验|端子|可执行结构|编码阶段|行为门禁|完整 Arduino 代码/i.test(failure);
            if (!recoverable || recoveryAttempt === 2)
                throw error;
            recoveryHint = failure;
            onPhase(`方案或代码校验未通过，Agent 正在进行第 ${recoveryAttempt + 1} 轮自主重建`);
        }
    }
    if (!result)
        throw new Error('Agent 自主修复后仍未得到可校验的项目结果');
    for (let attempt = 0; attempt < 4; attempt++) {
        const deterministicIssues = await auditGeneratedProject(goal, result);
        onPhase('独立审查器正在逐条核对功能行为');
        const reviewIssues = await reviewGeneratedProject(goal, result, apiKey, baseUrl, models.review);
        const unmet = [...new Set([...deterministicIssues, ...reviewIssues])];
        if (!unmet.length)
            break;
        onPhase(`需求核对发现 ${unmet.length} 项问题，进行第 ${attempt + 1} 轮修正`);
        result = await repairGeneratedProject(goal, result, unmet, apiKey, baseUrl, models.code);
    }
    const unresolved = await auditGeneratedProject(goal, result);
    const blocking = validateExecutableStructure(result.code);
    if (blocking.length)
        throw new ProjectAuditError(`代码经过自动修复后仍缺少可执行结构：${blocking.join('；')}`, result);
    if (unresolved.length)
        throw new ProjectAuditError(`代码经过自动修复后仍未通过行为门禁：${unresolved.join('；')}`, result);
    return result;
}
async function repairGeneratedProject(goal, draft, issues, apiKey, baseUrl, model) {
    const endpoint = aiEndpoint(baseUrl);
    const hardware = {
        board: draft.spec.board,
        components: draft.spec.components,
        connections: draft.spec.connections,
        libraries: draft.spec.libraries,
        verifiedHardwareKnowledge: [(0, hardwareCatalog_1.hardwareKnowledgeFor)(goal), (0, hardwareContracts_1.verifiedContractKnowledge)(goal)].filter(Boolean).join('\n')
    };
    const requiredBoardPins = draft.spec.connections
        .filter(connection => /Arduino|开发板|主板/i.test(connection.target) && /^(?:A\d+|D?\d+)$/i.test(connection.targetPin))
        .filter(connection => !/SPI\s*(?:SCK|MOSI|MISO)|spi-(?:sck|mosi|miso)/i.test(`${connection.signalType || ''} ${connection.sourcePin}`))
        .map(connection => `${connection.componentName} ${connection.sourcePin} -> ${connection.targetPin}`);
    const blockingIssues = [...new Set(issues.map(issue => issue.replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, 16);
    let attemptIssues = blockingIssues;
    let workingCode = draft.code;
    let bestCandidate = { ...draft, goal, wiringConfirmed: false };
    for (let attempt = 0; attempt < 3; attempt++) {
        const response = await requestAiWithRetry(endpoint, apiKey, { model, temperature: 0, max_tokens: 6000, messages: [
                { role: 'system', content: '你是 Arduino C++ 代码修复器。直接返回修复后的完整单文件.ino源码，不要JSON、Markdown、解释、TODO、伪代码或省略内容。源码必须包含全部#include、全局变量、函数、setup()和loop()，并以完整loop函数结束。requiredBoardPins是强制引脚合同：每一项都必须在真实对象初始化、attach、pinMode或读写调用的执行路径中使用，必须替换冲突的旧引脚，不能只写在注释或未调用变量里。保持给定硬件和引脚，禁止增加hardware中不存在的传感器、执行器、蜂鸣器或额外端子。issues中的每一项都是阻断条件，必须落实到真实执行路径，不能只改函数名、注释或声明。流水、滚动、拖尾必须用逐灯颜色或亮度历史数组，每次更新移动历史并向头部注入新值，禁止全灯填同色。代码紧凑，避免冗长注释。' },
                { role: 'user', content: attempt === 0
                        ? JSON.stringify({ goal, issues: attemptIssues, requiredBoardPins, hardware, currentCode: workingCode })
                        : `第${attempt + 1}次修复。项目目标：${goal}\n上一版仍未通过：${attemptIssues.join('；')}\n强制引脚合同：${requiredBoardPins.join('；')}\n硬件与接线：${JSON.stringify(hardware)}\n请从头紧凑重写完整.ino，不要解释：\n${workingCode}` }
            ]
        });
        if (!response.ok)
            throw await aiHttpError('AI 修复请求失败', response);
        const payload = await response.json();
        const content = (0, aiResponse_1.assistantText)(payload.choices?.[0]);
        if (!content)
            continue;
        try {
            const code = (0, aiResponse_1.extractArduinoCode)(content);
            const normalized = (0, hardwareCatalog_1.normalizeBoardPinSyntax)(code, draft.spec.board.fqbn);
            if (normalized && normalized !== draft.code.trim() && /\bvoid\s+setup\s*\(/.test(normalized) && /\bvoid\s+loop\s*\(/.test(normalized)) {
                const candidate = { ...draft, goal, code: normalized, wiringConfirmed: false };
                bestCandidate = candidate;
                const remaining = await auditGeneratedProject(goal, candidate);
                if (!remaining.length)
                    return candidate;
                attemptIssues = remaining.slice(0, 16);
                workingCode = normalized;
            }
        }
        catch {
            // 下一轮从同一份代码重新生成；失败后保留上一版供门禁复检。
        }
    }
    return applyBehaviorPrimitives(goal, bestCandidate, attemptIssues);
}
async function reviewGeneratedProject(goal, project, apiKey, baseUrl, model) {
    const response = await requestAiWithRetry(aiEndpoint(baseUrl), apiKey, { model, temperature: 0, max_tokens: 2400, response_format: { type: 'json_object' }, messages: [
            { role: 'system', content: '你是独立的Arduino固件审查器，不负责重写代码。只返回JSON对象 {"issues":["具体问题"]}。逐条对照projectSpec.behaviors、acceptance、connections和原始需求，检查每个行为是否真的在loop或被调用函数中实现，而不只是声明对象或初始化；检查传感器是否真实读取、执行器是否真实控制、定时逻辑、数组边界、按钮状态、总线和引脚冲突、Uno的2KB SRAM。不要把代码风格当问题，不要要求需求未指定的功能；没有问题返回空数组。' },
            { role: 'user', content: JSON.stringify({ originalRequirement: goal, projectSpec: project.spec, code: project.code }) }
        ] });
    if (!response.ok)
        return [`独立代码审查服务失败 (${response.status})`];
    try {
        const payload = await response.json();
        const parsed = (0, modelJson_1.parseModelJson)(payload.choices?.[0]?.message?.content || '');
        return Array.isArray(parsed.issues) ? parsed.issues.map(String).map(item => item.trim()).filter(Boolean).slice(0, 16) : [];
    }
    catch {
        return ['独立代码审查没有返回可解析的结果'];
    }
}
function validateRequirementCoverage(goal, project) {
    const issues = [];
    const code = project.code;
    // 仅检查带明确单位的参数。裸数字可能是步骤编号、型号、引脚或地址，不能作为阻断证据。
    // 只有决定硬件规模或离散功能数量的数字才作为生成门禁。
    // 采样周期、百分比、阈值和延时属于可调参数，不应因为模型采用等价值而阻止整个项目。
    const measured = [...goal.matchAll(/(\d+(?:\.\d+)?)\s*(?:颗(?:灯|灯珠)?|档|路|自由度)/gi)].map(match => match[1]);
    const explicitNumbers = [...new Set(measured)];
    for (const value of explicitNumbers) {
        if (!(0, workflow_1.codeContainsRequiredNumber)(code, value))
            issues.push(`代码没有落实需求中的数量或参数 ${value}`);
    }
    if (/流水|滚动|流动|拖尾/.test(goal)) {
        const hasPerLedHistory = /\b(?:ledColors|pixelColors|historyColors|ledBrightness|brightness)\s*\[/i.test(code);
        const hasShift = /getPixelColor\s*\(\s*i\s*-\s*1|\[[^\]]*i[^\]]*\]\s*=\s*[^;\n]*\[[^\]]*i\s*-\s*1|setPixelColor\s*\(\s*\(\s*i\s*[+-]/i.test(code);
        if (!hasPerLedHistory && !hasShift)
            issues.push('代码只是重复填色，没有保存或移动逐灯颜色，未形成真正的流水/拖尾动画');
    }
    if (/声音|麦克风|拾音/i.test(goal) && /analogRead/i.test(code) && !/(maximum\s*-\s*minimum|max\w*\s*-\s*min\w*|abs\s*\(|envelope|peakToPeak|peak_to_peak)/i.test(code)) {
        issues.push('声音强度直接使用单次模拟值，没有计算峰峰值、偏差或包络，实际音量变化可能无响应');
    }
    if (/变换颜色|颜色.*变化|渐变|蓝色|粉色|紫色/.test(goal) && !/(strip\.Color|setPixelColor|CRGB|CHSV|hue|palette)/i.test(code))
        issues.push('缺少颜色生成或颜色变化逻辑');
    if (/(五|5)\s*档/.test(goal) && !/(\[\s*5\s*\]|<\s*5|<=\s*4|case\s+4|level|band)/i.test(code))
        issues.push('缺少五档效果逻辑');
    if (/平滑|不忽闪|防抖/.test(goal) && !/(smooth|average|filter|ema|samples|\*\s*[1-9]\s*\+|\/\s*[2-9])/i.test(code))
        issues.push('缺少采样平滑或防闪烁逻辑');
    return issues;
}
async function offerGenerationRecovery(options) {
    const retry = '保留需求，继续重试';
    const revise = '修改原始描述';
    const settings = '检查 AI 设置';
    const details = '查看错误详情';
    const action = await plugin.window.showErrorMessage(`${options.message}\n你不需要重新开始，可以直接重试或修改原来的描述。`, { modal: true }, retry, revise, settings, details);
    if (action === retry) {
        void plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', {
            goal: options.currentGoal,
            beginnerMode: options.beginnerMode,
            skipBeginnerWizard: true
        });
        return;
    }
    if (action === revise) {
        void plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', {
            goal: options.originalGoal, beginnerMode: options.beginnerMode, showEditor: true
        });
        return;
    }
    if (action === settings) {
        await plugin.commands.executeCommand('arduinoFirstRunAgent.openSettings');
        return;
    }
    if (action === details) {
        const next = await plugin.window.showErrorMessage(`具体错误：\n${options.detail.slice(0, 4000)}`, { modal: true }, retry, revise, settings);
        if (next === retry)
            void plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', { goal: options.currentGoal, beginnerMode: options.beginnerMode, skipBeginnerWizard: true });
        if (next === settings)
            await plugin.commands.executeCommand('arduinoFirstRunAgent.openSettings');
        if (next === revise) {
            void plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', { goal: options.originalGoal, beginnerMode: options.beginnerMode, showEditor: true });
        }
    }
}
async function confirmGeneratedPlanInPanel(project, hostPanel, restoreHost) {
    return new Promise(resolve => {
        const ownsPanel = !hostPanel;
        const panel = hostPanel || plugin.window.createWebviewPanel('arduinoPlanConfirmation', '确认项目方案', plugin.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
        const components = project.spec.components.map(item => `<li><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.model || item.role)} ×${item.quantity}</span></li>`).join('');
        const connections = project.spec.connections.map(item => `<li><b>${escapeHtml(`${item.componentName} ${item.sourcePin}`)}</b><span>→ ${escapeHtml(`${item.target} ${item.targetPin}`)}</span></li>`).join('');
        const acceptance = project.spec.acceptance.map(item => `<li><b>验收</b><span>${escapeHtml(item.description)}</span></li>`).join('');
        panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:960px;margin:auto}header,.card{background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:20px;margin-bottom:12px}h1{margin:0 0 7px;font-size:22px}h2{font-size:16px;margin:0 0 10px}p{color:#66758a;line-height:1.6}ul{list-style:none;padding:0;margin:0}li{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #edf1f5}li span{color:#66758a;text-align:right}.actions{position:sticky;bottom:0;display:flex;justify-content:flex-end;gap:10px;padding:14px 0;background:#f5f7fb}button{border:0;border-radius:8px;padding:11px 16px;font-weight:700;cursor:pointer}.revise{background:#e8eef5;color:#294158}.confirm{background:#168c83;color:#fff}</style></head><body><main><header><h1>确认项目方案</h1><p>${escapeHtml(project.spec.goal)}</p></header><section class="card"><h2>开发板</h2><p>${escapeHtml(project.spec.board.name)} · ${escapeHtml(project.spec.board.fqbn)}</p></section><section class="card"><h2>元件</h2><ul>${components}</ul></section><section class="card"><h2>接线</h2><ul>${connections}</ul></section><section class="card"><h2>验收标准</h2><ul>${acceptance}</ul></section><div class="actions"><button id="revise" class="revise">修改原始描述</button><button id="confirm" class="confirm">确认并创建工程</button></div></main><script>const vscode=acquireVsCodeApi();document.getElementById('revise').onclick=()=>vscode.postMessage({type:'decision',value:'revise'});document.getElementById('confirm').onclick=()=>vscode.postMessage({type:'decision',value:'confirm'});</script></body></html>`;
        panel.webview.html = themedAgentHtml(panel.webview.html);
        let settled = false;
        let messageDisposable;
        let disposeDisposable;
        const finish = (value) => { if (settled)
            return; settled = true; messageDisposable?.dispose(); disposeDisposable?.dispose(); resolve(value); if (ownsPanel)
            panel.dispose();
        else if (value !== 'confirm')
            restoreHost?.(); };
        messageDisposable = panel.webview.onDidReceiveMessage(message => { if (message.type === 'decision' && (message.value === 'confirm' || message.value === 'revise'))
            finish(message.value); });
        disposeDisposable = panel.onDidDispose(() => { if (!settled) {
            settled = true;
            messageDisposable?.dispose();
            resolve(undefined);
        } });
    });
}
async function improveProject(brief, code, feedback, apiKey, baseUrl, model) {
    const response = await requestAiWithRetry(aiEndpoint(baseUrl), apiKey, { model, temperature: 0.15, response_format: { type: 'json_object' }, messages: [
            { role: 'system', content: '你是 Arduino 调试工程师。根据原始目标、当前完整代码和用户观察到的现象，提出最小必要修改并返回 JSON，字段为 code,summary,risks。code 必须是完整可编译 .ino 源码；保持原有引脚、硬件和库，除非反馈明确要求改变；不得输出 Markdown、TODO 或省略号。' },
            { role: 'user', content: JSON.stringify({ originalGoal: brief.goal, sensor: brief.sensor, output: brief.output, pins: [brief.sensorPin, brief.outputPin], currentCode: code, observedFeedback: feedback }) }
        ]
    });
    if (!response.ok)
        throw await aiHttpError('API 请求失败', response);
    const payload = await response.json();
    const content = payload.choices?.[0]?.message?.content;
    if (!content)
        throw new Error('模型没有返回修改结果');
    const raw = (0, modelJson_1.parseModelJson)(content);
    if (!raw || typeof raw !== 'object')
        throw new Error('模型返回的修改结果不是 JSON 对象');
    const value = raw;
    const codeResult = typeof value.code === 'string' ? (0, aiResponse_1.normalizeModelCode)(value.code) : '';
    const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
    const risks = Array.isArray(value.risks)
        ? value.risks.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)
        : typeof value.risks === 'string' && value.risks.trim() ? [value.risks.trim()] : [];
    if (!codeResult || !summary)
        throw new Error('模型返回的修改结果不完整');
    return { code: codeResult, summary, risks };
}
function validateProjectCode(code, brief) {
    const errors = [];
    if (!/\bvoid\s+setup\s*\(/.test(code))
        errors.push('缺少 setup()');
    if (!/\bvoid\s+loop\s*\(/.test(code))
        errors.push('缺少 loop()');
    if (/#include\s*[<"]Adafruit_NeoPixel\.h[>"]/i.test(code) && /\b(?:CRGB|CHSV)\b/.test(code))
        errors.push('Adafruit_NeoPixel 代码混用了 FastLED 的 CRGB/CHSV 类型');
    if (/Adafruit_MAX72XX/i.test(code))
        errors.push('Adafruit_MAX72XX 头文件或类不存在；MAX7219 点阵应改用 MD_MAX72XX 的真实 API');
    if (/```|\\#|\\_/.test(code))
        errors.push('代码中包含 Markdown 围栏或转义字符');
    const usesPin = (pin) => {
        const normalized = String(pin).trim().toUpperCase().replace(/^D(?=\d+$)/, '');
        if ((normalized === 'A4' || normalized === 'A5') && /#include\s*[<"]Wire\.h[>"]|\bWire\s*\./i.test(code))
            return true;
        if (/^\d+$/.test(normalized)) {
            if (normalized === '13' && /\bLED_BUILTIN\b/.test(code))
                return true;
            return new RegExp(`(?:^|[^A-Z0-9_])D?${normalized}(?:[^A-Z0-9_]|$)`, 'i').test(code);
        }
        return new RegExp(`(?:^|[^A-Z0-9_])${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Z0-9_]|$)`, 'i').test(code);
    };
    const pinValues = (description) => description
        .split(/[,，;；]/)
        .map(part => (part.includes('=') || part.includes(':') ? part.split(/[=:]/).pop() : part).trim())
        .filter(pin => /^(?:A\d+|D?\d+|LED_BUILTIN)$/i.test(pin));
    const missingSensorPins = pinValues(String(brief.sensorPin || '')).filter(pin => !usesPin(pin));
    const missingOutputPins = pinValues(String(brief.outputPin || '')).filter(pin => !usesPin(pin));
    if (missingSensorPins.length)
        errors.push(`代码未使用传感器引脚 ${missingSensorPins.join('、')}`);
    if (missingOutputPins.length)
        errors.push(`代码未使用输出引脚 ${missingOutputPins.join('、')}`);
    if (!brief.wiring?.length)
        errors.push('缺少接线信息');
    return errors;
}
function validateExecutableStructure(code) {
    const errors = [];
    if (!/\bvoid\s+setup\s*\(/.test(code))
        errors.push('缺少 setup()');
    if (!/\bvoid\s+loop\s*\(/.test(code))
        errors.push('缺少 loop()');
    if (/```|\\#|\\_/.test(code))
        errors.push('代码中包含 Markdown 围栏或转义字符');
    if (/#include\s*[<"]Adafruit_NeoPixel\.h[>"]/i.test(code) && /\b(?:CRGB|CHSV)\b/.test(code))
        errors.push('Adafruit_NeoPixel 代码混用了 FastLED 类型');
    if (/Adafruit_MAX72XX/i.test(code))
        errors.push('代码使用了不存在的 Adafruit_MAX72XX 接口');
    if (/TODO|Placeholder|占位|伪代码/i.test(code))
        errors.push('代码仍含TODO或占位实现');
    return errors;
}
function escapeHtml(value) {
    return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function agentWorkbenchThemeCss() {
    return `
  :root{--lab-bg:#07131f;--lab-surface:#0d1d2b;--lab-surface-2:#122738;--lab-line:#36566d;--lab-text:#f4fbfd;--lab-muted:#b7ced9;--lab-signal:#22d3b6;--lab-user:#72bcff;--lab-warning:#ffad42;--lab-danger:#ff6b68;--lab-glow:rgba(34,211,182,.18);color-scheme:dark}
  body{color:var(--lab-text)!important;background-color:var(--lab-bg)!important;background-image:linear-gradient(rgba(89,168,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(89,168,255,.045) 1px,transparent 1px),radial-gradient(circle at 84% 4%,rgba(34,211,182,.13),transparent 30%)!important;background-size:24px 24px,24px 24px,auto!important}
  main{position:relative;background-color:transparent!important;color:var(--lab-text)!important}main:before{content:"";display:block;width:52px;height:4px;margin:0 0 16px;border-radius:3px;background:linear-gradient(90deg,var(--lab-signal),var(--lab-user));box-shadow:0 0 16px var(--lab-glow)}
  header,.header,.card,.composer,.status,.goal,.notice,.option,.hardware,.choice,.provider,.node,.tip,.decision,.setting{background-color:rgba(13,29,43,.94)!important;border-color:var(--lab-line)!important;color:var(--lab-text)!important;box-shadow:none!important}.header{position:relative;padding:14px 16px;border:1px solid var(--lab-line);border-radius:12px}.header:after{content:"";position:absolute;left:16px;right:16px;bottom:-1px;height:1px;background:linear-gradient(90deg,var(--lab-signal),transparent 68%)}
  h1,h2,h3,strong,b,label,dt{color:var(--lab-text)!important}p,small,.hint,.sub,.why,.empty,.source,dd,.mini span,.provider span,.choice span,.mode span,.hardware small,.setting span,.image-source,.badges i,.option em,li span,.connection i,.confidence.not-run span,.confidence.unavailable span,.evidence span,.evidence time,.composer-footer span,time{color:var(--lab-muted)!important}a{color:#8fd8f4!important;text-decoration-color:rgba(143,216,244,.65)!important}
  input[type=text],input[type=password],textarea,select{background:#091925!important;color:var(--lab-text)!important;border-color:#527187!important;outline:none}input::placeholder,textarea::placeholder{color:#9bb7c5!important;opacity:1!important}input:focus,textarea:focus,select:focus{border-color:var(--lab-signal)!important;box-shadow:0 0 0 3px var(--lab-glow)!important}
  button{background:var(--lab-surface-2)!important;color:var(--lab-text)!important;border:1px solid var(--lab-line)!important;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}button:disabled{opacity:.72!important;color:#c3d5dd!important}button:hover:not(:disabled){transform:translateY(-1px);border-color:var(--lab-signal)!important;box-shadow:0 0 0 3px var(--lab-glow)!important}button.primary,button.confirm,button.save,button.submit,button.upload,#confirm:not(:disabled),#startProject{background:linear-gradient(135deg,#087e76,#12a994)!important;border-color:#35dbc0!important;color:#fff!important}button.back,button.cancel,button.revise{background:#14283a!important;color:#d3e3ea!important}
  .badge,.tag{background:rgba(34,211,182,.13)!important;color:#55ead0!important;border:1px solid rgba(34,211,182,.3)}.number{background:linear-gradient(135deg,#087e76,#12a994)!important;box-shadow:0 0 0 4px var(--lab-glow)}.status.error,.evidence.bad,.notice.changed{border-color:var(--lab-danger)!important}.status.error:before{background:var(--lab-danger)!important}.step,.step small,.step span{color:#bfe3ef!important}.step span{background:var(--lab-surface)!important;border-color:#42657b!important}.step.current span{background:var(--lab-signal)!important;border-color:var(--lab-signal)!important;color:#03110f!important;box-shadow:0 0 0 5px var(--lab-glow);animation:labPulse 1.8s ease-in-out infinite}.step.done span{background:#178a74!important;border-color:#31cbb0!important;color:#fff!important}.mini span{color:#8fd8f4!important}.status p{color:#b7d5e0!important}.connection,.mini,li{border-color:rgba(112,154,180,.38)!important}
  .hardware:has(input:checked),.choice:has(input:checked),.provider:has(input:checked),.option:has(input:checked){border-color:var(--lab-signal)!important;background:rgba(18,52,59,.96)!important}.wire:has(input:checked) .node{background:#10352f!important;border-color:var(--lab-signal)!important}.node.board{border-color:var(--lab-user)!important}.arrow{color:var(--lab-warning)!important}
  .progress,.actions{background-color:rgba(7,19,31,.94)!important}.eyebrow{color:var(--lab-signal)!important;letter-spacing:.14em!important}.header h1{letter-spacing:-.02em}.evidence.good b,.confidence.passed span{color:#55ead0!important}.evidence.bad b,.confidence.failed span,.license-warning{color:#ff8b87!important}
  @keyframes labPulse{0%,100%{box-shadow:0 0 0 3px rgba(34,211,182,.12)}50%{box-shadow:0 0 0 8px rgba(34,211,182,.03)}}
  @media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
  `;
}
function themedAgentHtml(html) {
    return html.replace('</style>', `${agentWorkbenchThemeCss()}</style>`);
}
function wiringDiagramHtml(brief) {
    const lines = brief.wiring?.length ? brief.wiring : wiringChecklist(brief);
    const rows = lines.map((line, index) => {
        const parts = line.split(/\s*(?:->|→|接到|连接到)\s*/);
        const checked = brief.wiringConfirmed || Boolean(brief.spec?.connections[index]?.confirmed);
        return parts.length > 1
            ? `<label class="wire"><input class="wire-check" type="checkbox" ${checked ? 'checked' : ''}><div class="node">${escapeHtml(parts[0])}</div><div class="arrow">→</div><div class="node board">${escapeHtml(parts.slice(1).join(' → '))}</div></label>`
            : `<label class="note"><input class="wire-check" type="checkbox" ${checked ? 'checked' : ''}><span>${escapeHtml(line)}</span></label>`;
    }).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
  *{box-sizing:border-box}body{font-family:Arial,"Microsoft YaHei",sans-serif;background:#f5f7fb;color:#203047;padding:24px;margin:0}h2{margin:0 0 6px}.sub{color:#66758a;margin-bottom:16px;line-height:1.6}.progress{position:sticky;top:0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px;background:#eaf3ff;border:1px solid #b8d6ff;border-radius:10px;padding:12px 14px;margin-bottom:18px;box-shadow:0 4px 12px #20304714}.progress b{display:block}.progress span{color:#66758a;font-size:12px}button{border:0;border-radius:7px;padding:10px 14px;background:#168c83;color:#fff;font-weight:700;cursor:pointer}button:disabled{background:#aebbc5;cursor:not-allowed}.wire{display:grid;grid-template-columns:28px minmax(180px,1fr) 54px minmax(180px,1fr);align-items:center;margin:12px 0;cursor:pointer}.wire input,.note input{width:18px;height:18px;accent-color:#168c83}.node{background:#fff;border:2px solid #25a18e;border-radius:10px;padding:14px;text-align:center;font-weight:600}.node.board{border-color:#3578e5}.arrow{text-align:center;color:#ef6c35;font-size:28px;font-weight:bold}.wire:has(input:checked) .node{background:#effbf8}.note{display:flex;align-items:center;gap:10px;background:#fff8e6;border-left:4px solid #f0a52b;padding:12px;margin:10px 0;border-radius:6px}.tip{margin-top:22px;padding:14px;background:#eaf3ff;border-radius:8px;line-height:1.6}@media(max-width:700px){.wire{grid-template-columns:28px 1fr}.wire .arrow{display:none}.wire .node.board{grid-column:2;margin-top:6px}.progress{align-items:flex-start;flex-direction:column}}
  </style></head><body><button id="back" style="margin-bottom:14px;background:#e8eef5;color:#294158">返回项目看板</button><h2>项目接线图与核对</h2><div class="sub">${escapeHtml(brief.goal)}</div><div class="progress"><div><b id="count">正在读取核对进度</b><span>请只勾选已经在实物上确认的接线</span></div><button id="confirm" disabled>${brief.wiringConfirmed ? '接线已确认' : '确认全部接线'}</button></div>${rows}<div class="tip">请断电接线，边看接线图边逐项勾选。Agent 会检查代码与接线图中的引脚是否一致，但无法直接看见实际导线。</div><script>
  const vscode=acquireVsCodeApi();const checks=[...document.querySelectorAll('.wire-check')];const button=document.getElementById('confirm');const count=document.getElementById('count');const already=${brief.wiringConfirmed ? 'true' : 'false'};
  function update(){const done=checks.filter(item=>item.checked).length;count.textContent='已确认 '+done+' / '+checks.length+' 项';button.disabled=already||done!==checks.length}checks.forEach(item=>item.addEventListener('change',update));button.addEventListener('click',()=>{if(!button.disabled)vscode.postMessage({type:'confirmWiring'})});document.getElementById('back').onclick=()=>vscode.postMessage({type:'backDashboard'});update();
  </script></body></html>`;
}
function behaviorFeedbackHtml(goal, spec) {
    const observed = spec?.acceptance.filter(item => item.evidence === 'user') || [];
    const checklist = observed.length ? `<section><h2>逐项核对实际效果</h2><p>请亲眼观察后再勾选。没有把握的项目先留空，Agent 不会替你判断实物。</p>${observed.map(item => `<label class="choice"><input type="checkbox" class="observed" value="${escapeHtml(item.id)}" ${item.passed ? 'checked' : ''}><span><b>${escapeHtml(item.description)}</b></span></label>`).join('')}</section>` : '';
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:auto;background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:22px}h1{font-size:22px;margin:0 0 7px}h2{font-size:16px}p{color:#66758a;line-height:1.6}.choices{display:grid;grid-template-columns:1fr;gap:9px;margin:18px 0}.choice{display:flex;gap:10px;border:2px solid #dce4ee;border-radius:10px;padding:13px;cursor:pointer}.choice:has(input:checked){border-color:#168c83;background:#eef9f7}.choice b,.choice span{display:block}.choice span{color:#66758a;margin-top:3px}textarea{width:100%;min-height:150px;resize:vertical;border:1px solid #cbd5e1;border-radius:9px;padding:11px;font:inherit;line-height:1.6}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}button{border:0;border-radius:8px;padding:11px 16px;font-weight:700;cursor:pointer}.back{background:#e8eef5;color:#294158}.submit{background:#168c83;color:#fff}</style></head><body><main><h1>反馈实物运行效果</h1><p>${escapeHtml(goal)}</p>${checklist}<div class="choices"><label class="choice"><input type="radio" name="symptom" value="运行正常" checked><span><b>运行正常</b><span>实际效果已经达到需求</span></span></label><label class="choice"><input type="radio" name="symptom" value="没有反应"><span><b>没有反应</b><span>设备、传感器或执行器没有动作</span></span></label><label class="choice"><input type="radio" name="symptom" value="效果不符合预期"><span><b>效果不符合预期</b><span>可以运行，但表现与目标不同</span></span></label></div><textarea id="detail" placeholder="可补充你看到的现象，例如：拍手后串口数值变化，但灯带一直熄灭"></textarea><div class="actions"><button id="back" class="back">返回项目看板</button><button id="submit" class="submit">提交反馈</button></div></main><script>const vscode=acquireVsCodeApi();document.getElementById('back').onclick=()=>vscode.postMessage({type:'backDashboard'});document.getElementById('submit').onclick=()=>{const symptom=document.querySelector('input[name="symptom"]:checked').value;const detail=document.getElementById('detail').value.trim();const confirmedIds=[...document.querySelectorAll('.observed:checked')].map(x=>x.value);vscode.postMessage({type:'behaviorFeedback',symptom,detail,confirmedIds})};</script></body></html>`;
}
function behaviorDiagnosisHtml(goal, symptom, detail, advice) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:auto}.card{background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:20px;margin-bottom:12px}h1{font-size:22px;margin:0 0 7px}h2{font-size:15px;margin:0 0 8px}p{color:#526176;line-height:1.7;white-space:pre-wrap}.actions{display:grid;grid-template-columns:1fr;gap:9px}button{border:1px solid #dce4ee;border-radius:9px;padding:12px;text-align:left;font:inherit;font-weight:700;cursor:pointer;background:#fff;color:#203047}button.primary{background:#168c83;color:#fff;border-color:#168c83}</style></head><body><main><section class="card"><h1>实物效果诊断</h1><p>${escapeHtml(goal)}</p></section><section class="card"><h2>你反馈的现象</h2><p>${escapeHtml(symptom)}\n${escapeHtml(detail)}</p></section><section class="card"><h2>Agent 建议</h2><p>${escapeHtml(advice)}</p></section><section class="actions"><button class="primary" data-action="ai">让 AI 修改代码并重新检查</button><button data-action="open">打开当前代码</button><button data-action="compile">保持代码不变，重新编译</button><button data-action="back">返回项目看板</button></section></main><script>const vscode=acquireVsCodeApi();document.addEventListener('click',event=>{const button=event.target.closest('button');if(button)vscode.postMessage({type:'behaviorAction',action:button.dataset.action,symptom:${JSON.stringify(symptom)},detail:${JSON.stringify(detail)}})});</script></body></html>`;
}
function startupSettingsHtml(startWithNewProject, openDashboardOnStartup) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  *{box-sizing:border-box}body{margin:0;padding:22px;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:auto}.header{margin-bottom:16px}.header h1{margin:0 0 7px;font-size:22px}.header p{margin:0;line-height:1.7}.settings{display:grid;gap:12px}.setting{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;padding:18px;border:1px solid #dce4ee;border-radius:10px;cursor:pointer}.setting b,.setting span{display:block}.setting b{font-size:16px;margin-bottom:5px}.setting span{line-height:1.6}.switch{position:relative;width:52px;height:30px}.switch input{position:absolute;opacity:0}.track{display:block;width:52px;height:30px;border-radius:15px;background:#516473;transition:.18s}.track:after{content:"";position:absolute;width:22px;height:22px;left:4px;top:4px;border-radius:50%;background:#fff;transition:.18s}.switch input:checked+.track{background:#12a994}.switch input:checked+.track:after{transform:translateX(22px)}.note{margin:16px 0;padding:12px 14px;border-left:4px solid #59a8ff;line-height:1.65}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid #dce4ee}button{border:1px solid #dce4ee;border-radius:8px;padding:10px 15px;font:inherit;font-weight:700;cursor:pointer}.save{background:#168c83;color:#fff}.back{background:#e8eef5;color:#294158}@media(max-width:600px){.setting{grid-template-columns:1fr}.actions{flex-direction:column-reverse}button{width:100%}}
  </style></head><body><main><section class="header"><div class="eyebrow">ARDUINO AGENT SETTINGS</div><h1>启动设置</h1><p>选择 Arduino IDE 每次打开时自动执行什么。两个选项互不影响，之后仍可随时手动打开 Agent。</p></section><section class="settings"><label class="setting"><span><b>创建新的空白 Arduino 草稿</b><span>开启后，启动 IDE 时不显示上一次的 .ino 文件，而是进入新项目。</span></span><span class="switch"><input id="newProject" type="checkbox" ${startWithNewProject ? 'checked' : ''}><span class="track"></span></span></label><label class="setting"><span><b>自动打开 Agent 项目看板</b><span>关闭后不会自动占用右侧空间，可点击编辑器顶部的“⚡ Arduino Agent 看板”打开。</span></span><span class="switch"><input id="openDashboard" type="checkbox" ${openDashboardOnStartup ? 'checked' : ''}><span class="track"></span></span></label></section><div class="note">设置从下一次启动 Arduino IDE 起生效，不会删除现有项目或 Agent 记录。</div><div class="actions"><button id="back" class="back">返回项目看板</button><button id="save" class="save">保存启动设置</button></div></main><script>const vscode=acquireVsCodeApi();document.getElementById('back').onclick=()=>vscode.postMessage({type:'backDashboard'});document.getElementById('save').onclick=()=>{const button=document.getElementById('save');button.disabled=true;button.textContent='正在保存…';vscode.postMessage({type:'saveStartupSettings',startWithNewProject:document.getElementById('newProject').checked,openDashboardOnStartup:document.getElementById('openDashboard').checked})};</script></body></html>`;
}
function aiSettingsHtml(provider, baseUrl, apiMode, model, keyConfigured) {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:auto;background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:22px}h1{font-size:22px;margin:0 0 7px}p{color:#66758a;line-height:1.6}.providers{display:grid;grid-template-columns:1fr;gap:8px;margin:17px 0}.provider{display:flex;gap:10px;border:2px solid #dce4ee;border-radius:10px;padding:12px;cursor:pointer}.provider:has(input:checked){border-color:#168c83;background:#eef9f7}.provider b,.provider span{display:block}.provider span{color:#66758a;font-size:12px;margin-top:3px}label.field{display:block;font-weight:700;margin:14px 0 6px}input[type=text],input[type=password],select{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:10px;font:inherit;background:#fff;color:#203047}.note{margin-top:12px;padding:11px;border-radius:8px;background:#eef6ff;color:#34506f}.links{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.links button{background:#e8eef5;color:#294158}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px;padding-top:14px;border-top:1px solid #e5e7eb}button{border:0;border-radius:8px;padding:10px 15px;font-weight:700;cursor:pointer}.back{background:#e8eef5;color:#294158}.save{background:#168c83;color:#fff}</style></head><body><main><h1>AI 服务设置</h1><p>在同一页面查看和修改配置。保存前会实际测试模型是否能生成完整 Arduino 代码。</p><div class="providers"><label class="provider"><input type="radio" name="provider" value="ollama" ${provider === 'ollama' ? 'checked' : ''}><span><b>本地 Ollama</b><span>无需 API Key，可离线；速度取决于电脑性能</span></span></label><label class="provider"><input type="radio" name="provider" value="openai" ${provider === 'openai' ? 'checked' : ''}><span><b>OpenAI 云端</b><span>需要独立 API Key，API 与网页版账号分开</span></span></label><label class="provider"><input type="radio" name="provider" value="compatible" ${provider === 'compatible' ? 'checked' : ''}><span><b>其他兼容服务</b><span>Kimi、DeepSeek、第三方网关或自建服务</span></span></label></div><label class="field">API 基础地址</label><input id="baseUrl" type="text" value="${escapeHtml(baseUrl)}"><label class="field">接口协议</label><select id="apiMode"><option value="chat-completions" ${apiMode === 'chat-completions' ? 'selected' : ''}>Chat Completions</option><option value="responses" ${apiMode === 'responses' ? 'selected' : ''}>Responses API</option></select><label class="field">模型名称</label><input id="model" type="text" value="${escapeHtml(model)}"><label class="field">API Key</label><input id="apiKey" type="password" placeholder="${keyConfigured ? '已保存；不修改请留空' : '云端服务必须填写'}"><div class="note" id="status">${keyConfigured ? 'API Key 已安全保存，不显示明文。' : provider === 'ollama' ? '本地 Ollama 不需要 API Key。' : '当前尚未保存 API Key。'}</div><div class="links"><button data-url="https://platform.openai.com/api-keys">OpenAI 指引</button><button data-url="https://platform.moonshot.cn/docs">Kimi 指引</button><button data-url="https://api-docs.deepseek.com/">DeepSeek 指引</button><button data-url="https://ollama.com/download">Ollama 下载</button></div><div class="actions"><button id="back" class="back">返回项目看板</button><button id="save" class="save">测试并保存</button></div></main><script>const vscode=acquireVsCodeApi(),byId=id=>document.getElementById(id);document.querySelectorAll('input[name="provider"]').forEach(input=>input.addEventListener('change',()=>{const p=input.value;if(!input.checked)return;if(p==='ollama'){byId('baseUrl').value='http://localhost:11434/v1';byId('apiMode').value='chat-completions';if(!byId('model').value)byId('model').value='qwen2.5-coder:14b'}else if(p==='openai'){byId('baseUrl').value='https://api.openai.com/v1';byId('apiMode').value='responses'}}));document.querySelectorAll('[data-url]').forEach(button=>button.onclick=()=>vscode.postMessage({type:'openExternal',url:button.dataset.url}));byId('back').onclick=()=>vscode.postMessage({type:'backDashboard'});byId('save').onclick=()=>{const button=byId('save');button.disabled=true;button.textContent='正在测试模型…';vscode.postMessage({type:'saveAiSettings',provider:document.querySelector('input[name="provider"]:checked').value,baseUrl:byId('baseUrl').value.trim(),apiMode:byId('apiMode').value,model:byId('model').value.trim(),apiKey:byId('apiKey').value.trim()})};</script></body></html>`;
}
async function confirmRevisionInPanel(revision, hostPanel, restoreHost) {
    return new Promise(resolve => {
        if (!hostPanel) {
            resolve(false);
            return;
        }
        hostPanel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:auto}.card{background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:20px;margin-bottom:12px}h1{font-size:22px;margin:0 0 8px}p,li{color:#526176;line-height:1.7}pre{max-height:420px;overflow:auto;background:#172033;color:#e8eef5;border-radius:10px;padding:14px;white-space:pre-wrap}.actions{display:flex;justify-content:flex-end;gap:10px;position:sticky;bottom:0;padding:14px 0;background:#f5f7fb}button{border:0;border-radius:8px;padding:11px 16px;font-weight:700;cursor:pointer}.cancel{background:#e8eef5;color:#294158}.apply{background:#168c83;color:#fff}</style></head><body><main><section class="card"><h1>确认 AI 代码修改</h1><p>${escapeHtml(revision.summary)}</p>${revision.risks?.length ? `<ul>${revision.risks.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}</section><section class="card"><h1>修改后的完整代码预览</h1><pre>${escapeHtml(revision.code)}</pre></section><div class="actions"><button id="cancel" class="cancel">保留当前代码</button><button id="apply" class="apply">应用并自动重新编译</button></div></main><script>const vscode=acquireVsCodeApi();document.getElementById('cancel').onclick=()=>vscode.postMessage({type:'revisionDecision',apply:false});document.getElementById('apply').onclick=()=>vscode.postMessage({type:'revisionDecision',apply:true});</script></body></html>`;
        hostPanel.webview.html = themedAgentHtml(hostPanel.webview.html);
        let settled = false;
        let messageDisposable;
        let disposeDisposable;
        const finish = (value) => { if (settled)
            return; settled = true; messageDisposable?.dispose(); disposeDisposable?.dispose(); resolve(value); if (!value)
            restoreHost?.(); };
        messageDisposable = hostPanel.webview.onDidReceiveMessage(message => { if (message.type === 'revisionDecision')
            finish(message.apply === true); });
        disposeDisposable = hostPanel.onDidDispose(() => { if (!settled) {
            settled = true;
            messageDisposable?.dispose();
            resolve(false);
        } });
    });
}
function diagnosis(text) {
    const t = text.toLowerCase();
    const location = text.match(/^(.+?\.ino):(\d+):(\d+):\s*(?:fatal\s+)?error:\s*(.+)$/mi);
    const file = location?.[1];
    const line = location ? Number(location[2]) : undefined;
    const column = location ? Number(location[3]) : undefined;
    const detail = location?.[4] || '';
    if (/expected ['‘]?;['’]? before/i.test(detail) || /expected ['‘]?;['’]? before/i.test(text)) {
        const before = detail.match(/before\s+['‘]([^'’]+)['’]/i)?.[1];
        return {
            title: '缺少分号', file, line, column,
            advice: `编译器在第 ${line || '对应'} 行发现语句没有正常结束。Agent 会把第一条错误和完整代码交给代码模型自动修复${before ? `；错误在 ${before} 之前暴露` : ''}。`,
            fixKind: 'semicolon'
        };
    }
    if (t.includes('no such file or directory') && /#include|fatal error/.test(t)) {
        const header = text.match(/fatal error:\s*([^:\r\n]+):\s*No such file/i)?.[1]?.trim();
        const isNeoPixel = Boolean(header && /neopixel/i.test(header));
        return { title: '缺少代码库', file, line, column, header, library: isNeoPixel ? 'Adafruit NeoPixel' : undefined, correctedHeader: isNeoPixel ? 'Adafruit_NeoPixel.h' : undefined, fixKind: 'library', advice: `找不到 ${header || '代码引用的头文件'}。Agent 将查询 Arduino 官方索引、安装兼容库并自动重新编译。` };
    }
    if (t.includes('was not declared in this scope')) {
        const name = text.match(/['‘]([^'’]+)['’] was not declared/i)?.[1];
        return { title: '名称未定义', file, line, column, advice: `${name ? `“${name}”` : '某个名称'}在使用前没有定义。Agent 将根据作用域和完整编译日志自动修复。` };
    }
    if (t.includes('ser_open') || t.includes('port') || t.includes('no such file')) {
        return { title: '串口问题', advice: '请重新插拔主板，在“端口”列表选择新出现的串口；如果没有出现，检查 USB 数据线和驱动。' };
    }
    if (t.includes('board') || t.includes('fqbn') || t.includes('platform')) {
        return { title: '板型或核心问题', advice: '请确认 IDE 里的板型与实物一致，并安装对应的 Arduino AVR Boards 核心。' };
    }
    if (t.includes('not declared') || t.includes('expected') || t.includes('error:')) {
        return { title: '代码编译错误', file, line, column, advice: `错误位置：${line ? `第 ${line} 行` : '日志中的第一条 error'}。Agent 将调用代码模型修复并重新编译；初学者无需手工改代码。` };
    }
    return { title: '暂未识别', advice: '当前日志不足以给出可靠修改。请粘贴从第一条 error 开始的完整日志。' };
}
function currentSketch() {
    const editor = plugin.window.activeTextEditor;
    const file = editor?.document.uri.fsPath;
    if (!file || !file.toLowerCase().endsWith('.ino'))
        return undefined;
    return { folder: (0, path_1.dirname)(file), file };
}
function isTemporarySketchPath(path) {
    return /[\\/](?:Temp|tmp)[\\/].*\.arduinoIDE-unsaved|\.arduinoIDE-unsaved/i.test(path);
}
function canonicalSketchUri(uri) {
    const name = (0, path_1.basename)(uri.fsPath, (0, path_1.extname)(uri.fsPath));
    return (0, path_1.basename)((0, path_1.dirname)(uri.fsPath)).toLowerCase() === name.toLowerCase()
        ? uri
        : plugin.Uri.file((0, path_1.join)((0, path_1.dirname)(uri.fsPath), name, `${name}.ino`));
}
async function ensureSketchLayout(file) {
    const source = plugin.Uri.file(file);
    const target = canonicalSketchUri(source);
    if (target.fsPath.toLowerCase() === source.fsPath.toLowerCase())
        return { file, migrated: false };
    await plugin.workspace.fs.createDirectory(plugin.Uri.file((0, path_1.dirname)(target.fsPath)));
    await plugin.workspace.fs.writeFile(target, await plugin.workspace.fs.readFile(source));
    return { file: target.fsPath, migrated: true };
}
function defaultProjectRoot() {
    const configured = plugin.workspace.getConfiguration('arduinoAgent').get('projectRoot', '').trim();
    if (configured)
        return configured;
    return (0, fs_1.existsSync)('D:\\') ? 'D:\\ArduinoProjects' : (0, path_1.join)((0, os_1.homedir)(), 'Documents', 'Arduino');
}
async function showTextDocumentOnce(document, preferredColumn) {
    if (preferredColumn !== undefined) {
        return plugin.window.showTextDocument(document, { viewColumn: preferredColumn, preserveFocus: false, preview: false });
    }
    const existing = plugin.window.visibleTextEditors.find(editor => editor.document.uri.fsPath.toLowerCase() === document.uri.fsPath.toLowerCase());
    if (existing) {
        return plugin.window.showTextDocument(existing.document, {
            viewColumn: existing.viewColumn,
            preserveFocus: false,
            preview: false
        });
    }
    return plugin.window.showTextDocument(document, { preserveFocus: false, preview: false });
}
function isBlankStarterSketch(text) {
    const withoutComments = text.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
    return withoutComments === 'voidsetup(){}voidloop(){}' || withoutComments.length === 0;
}
function compileArgs(folder, fqbn = 'arduino:avr:uno') {
    return ['compile', '--fqbn', fqbn, '--libraries', (0, path_1.join)((0, os_1.homedir)(), 'Documents', 'Arduino', 'libraries'), folder];
}
async function compileWithPlatformRecovery(folder, fqbn = 'arduino:avr:uno', timeout = 180000) {
    let result = await runCli(compileArgs(folder, fqbn), folder, timeout);
    if (result.code === 0)
        return result;
    const log = `${result.stdout}\n${result.stderr}`;
    const missing = (0, cliRecovery_1.missingPlatformFromLog)(log);
    const core = missing || (0, cliRecovery_1.coreIdFromFqbn)(fqbn);
    if (!missing || !core)
        return result;
    plugin.window.setStatusBarMessage(`Arduino Agent：正在安装开发板平台 ${core}…`, 120000);
    const installed = await runCli(['core', 'install', core], folder, 300000);
    if (installed.code !== 0)
        return { code: installed.code, stdout: `${result.stdout}\n${installed.stdout}`, stderr: `${result.stderr}\n平台 ${core} 自动安装失败：\n${installed.stderr}` };
    plugin.window.setStatusBarMessage(`Arduino Agent：${core} 已安装，正在重新编译…`, 120000);
    result = await runCli(compileArgs(folder, fqbn), folder, timeout);
    return result;
}
function canonicalLibraryName(name) {
    const value = name.trim();
    const aliases = [
        [/^DHT(?:\.h)?$|DHT sensor/i, 'DHT sensor library'],
        [/NeoPixel/i, 'Adafruit NeoPixel'],
        [/SSD1306/i, 'Adafruit SSD1306'],
        [/Adafruit.*GFX|^GFX$/i, 'Adafruit GFX Library'],
        [/Adafruit.*MQTT/i, 'Adafruit MQTT Library'],
        [/BH1750/i, 'BH1750'],
        [/TCS34725/i, 'Adafruit TCS34725'],
        [/APDS.?9960/i, 'Adafruit APDS9960 Library'],
        [/MAX72(?:19|XX)/i, 'MD_MAX72XX'],
        [/^Servo(?:\.h)?$/i, 'Servo'],
        [/^IRremote(?:\.h)?$/i, 'IRremote'],
        [/DallasTemperature/i, 'DallasTemperature'],
        [/^OneWire(?:\.h)?$/i, 'OneWire'],
        [/AccelStepper/i, 'AccelStepper'],
        [/NewPing/i, 'NewPing']
    ];
    return aliases.find(([pattern]) => pattern.test(value))?.[1] || value;
}
function librariesFromCode(code) {
    const headerMap = [
        [/DHT\.h/i, 'DHT sensor library'],
        [/Adafruit_NeoPixel\.h/i, 'Adafruit NeoPixel'],
        [/Adafruit_SSD1306\.h/i, 'Adafruit SSD1306'],
        [/Adafruit_GFX\.h/i, 'Adafruit GFX Library'],
        [/Adafruit_MQTT(?:_Client)?\.h/i, 'Adafruit MQTT Library'],
        [/BH1750\.h/i, 'BH1750'],
        [/Adafruit_TCS34725\.h/i, 'Adafruit TCS34725'],
        [/Adafruit_APDS9960\.h/i, 'Adafruit APDS9960 Library'],
        [/(?:MD_MAX72xx|Adafruit_MAX72XX)\.h/i, 'MD_MAX72XX'],
        [/(?:^|[<"])Servo\.h/i, 'Servo'],
        [/IRremote(?:\.hpp|\.h)/i, 'IRremote'],
        [/DallasTemperature\.h/i, 'DallasTemperature'],
        [/OneWire\.h/i, 'OneWire'],
        [/AccelStepper\.h/i, 'AccelStepper'],
        [/NewPing\.h/i, 'NewPing']
    ];
    return headerMap.filter(([header]) => header.test(code)).map(([, library]) => library);
}
async function discoverLibrariesFromIndex(code, fqbn) {
    const knownHeaderPatterns = [
        /DHT\.h/i, /Adafruit_NeoPixel\.h/i, /Adafruit_SSD1306\.h/i, /Adafruit_GFX\.h/i,
        /Adafruit_MQTT(?:_Client)?\.h/i, /BH1750\.h/i, /Adafruit_TCS34725\.h/i,
        /Adafruit_APDS9960\.h/i, /MD_MAX72xx\.h/i, /IRremote(?:\.hpp|\.h)/i,
        /DallasTemperature\.h/i, /OneWire\.h/i, /AccelStepper\.h/i, /NewPing\.h/i
    ];
    const libraries = [];
    const issues = [];
    for (const header of (0, libraryIndex_1.extractExternalHeaders)(code).slice(0, 16)) {
        if (knownHeaderPatterns.some(pattern => pattern.test(header)))
            continue;
        const library = await findLibraryForHeader(header, fqbn);
        if (library)
            libraries.push(library);
        else
            issues.push(`Arduino官方库索引中没有任何库提供头文件 ${header}，该头文件可能是模型虚构的`);
    }
    return { libraries: [...new Set(libraries)], issues };
}
async function findLibraryForHeader(header, fqbn) {
    const byHeader = await runCli(['lib', 'search', `provides:${header}`, '--format', 'json', '--omit-releases-details']);
    if (byHeader.code === 0) {
        const match = (0, libraryIndex_1.chooseLibraryForHeader)(header, (0, libraryIndex_1.parseLibraryCandidates)(byHeader.stdout), fqbn);
        if (match)
            return match;
    }
    // 部分官方库条目没有 provides_includes；再按头文件主名精确查询库名。
    const stem = header.replace(/^.*[\\/]/, '').replace(/\.h(?:pp)?$/i, '');
    const byName = await runCli(['lib', 'search', `name=${stem}`, '--format', 'json', '--omit-releases-details']);
    if (byName.code === 0) {
        const exactName = (0, libraryIndex_1.chooseLibraryForHeader)(header, (0, libraryIndex_1.parseLibraryCandidates)(byName.stdout), fqbn);
        if (exactName)
            return exactName;
    }
    const terms = stem.split(/[_\-\s]+/).filter(term => term.length > 1 && !/^(?:lib|library|sensor)$/i.test(term));
    if (!terms.length)
        return undefined;
    const fuzzy = await runCli(['lib', 'search', ...terms, '--format', 'json', '--omit-releases-details']);
    if (fuzzy.code !== 0)
        return undefined;
    return (0, libraryIndex_1.chooseLibraryByNameSimilarity)(header, (0, libraryIndex_1.parseLibraryCandidates)(fuzzy.stdout), fqbn);
}
async function installMissingHeaderFromLog(log, fqbn) {
    const header = log.match(/fatal error:\s*([^:\r\n]+):\s*No such file/i)?.[1]?.trim();
    if (!header)
        return {};
    const library = await findLibraryForHeader(header, fqbn);
    if (!library)
        return { header, error: `Arduino官方库索引找不到提供 ${header} 的兼容库` };
    const result = await runCli(['lib', 'install', library]);
    if (result.code !== 0 && !/already installed/i.test(`${result.stdout}\n${result.stderr}`))
        return { header, error: `安装 ${library} 失败：${(result.stderr || result.stdout).trim().slice(-500)}` };
    return { header, installed: library };
}
async function auditGeneratedProject(goal, project) {
    const libraryAudit = await discoverLibrariesFromIndex(project.code, project.spec.board.fqbn);
    project.libraries = [...new Set([...(0, workflow_1.normalizeLibraryNames)(project.libraries), ...libraryAudit.libraries])];
    project.spec.libraries = project.libraries;
    return [...new Set([
            ...validateProjectCode(project.code, project),
            ...validateRequirementCoverage(goal, project),
            ...(0, workflow_1.evaluateProjectSpec)(project.spec),
            ...(0, hardwareCatalog_1.evaluateSpecHardware)(project.spec),
            ...evaluateLockedHardware(goal, project.spec),
            ...(0, workflow_1.evaluateCodeAgainstSpec)(project.code, project.spec),
            ...(0, hardwareCatalog_1.evaluateHardwareCode)(goal, project.code),
            ...libraryAudit.issues
        ])];
}
async function installProjectLibraries(project) {
    const indexAudit = await discoverLibrariesFromIndex(project.code, project.spec.board.fqbn);
    const required = [...new Set([
            ...(0, workflow_1.normalizeLibraryNames)(project.libraries).map(canonicalLibraryName),
            ...librariesFromCode(project.code),
            ...indexAudit.libraries
        ])].filter(name => name && name !== '[object Object]');
    project.libraries = required;
    project.spec.libraries = required;
    const failures = [];
    for (const library of required) {
        const installed = await runCli(['lib', 'install', library]);
        if (installed.code !== 0 && !/already installed/i.test(`${installed.stdout}\n${installed.stderr}`))
            failures.push(`${library}: ${(installed.stderr || installed.stdout).trim().slice(-500)}`);
    }
    return failures;
}
async function installedLibraryMetadata(names) {
    const result = await runCli(['lib', 'list', '--format', 'json']);
    if (result.code !== 0)
        return names.map(name => ({ name, version: '未知版本', license: '许可证查询失败' }));
    const installed = (0, libraryIndex_1.parseInstalledLibraries)(result.stdout);
    return names.map(name => installed.find(item => item.name.toLowerCase() === name.toLowerCase()) || { name, version: '未安装', license: '许可证未知' });
}
async function installedLibraryDetails(names) {
    const result = await runCli(['lib', 'list', '--format', 'json']);
    if (result.code !== 0)
        return names.map(name => ({ name, version: '未知版本', license: '许可证查询失败' }));
    let rows = [];
    try {
        rows = JSON.parse(result.stdout).installed_libraries || [];
    }
    catch {
        return names.map(name => ({ name, version: '未知版本', license: '许可证数据无法解析' }));
    }
    return names.map(name => {
        const library = rows.map(row => row.library || {}).find(item => String(item.name || '').toLowerCase() === name.toLowerCase());
        if (!library)
            return { name, version: '未安装', license: '许可证未知' };
        const installDir = typeof library.install_dir === 'string' ? library.install_dir : undefined;
        let licenseFile;
        let licenseText;
        if (installDir && (0, fs_1.existsSync)(installDir)) {
            const file = (0, fs_1.readdirSync)(installDir).find(item => /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:\..*)?$/i.test(item));
            if (file) {
                licenseFile = (0, path_1.join)(installDir, file);
                try {
                    licenseText = (0, fs_1.readFileSync)(licenseFile, 'utf8').slice(0, 250000);
                }
                catch {
                    licenseText = undefined;
                }
            }
        }
        const cliLicense = typeof library.license === 'string' && !/^unspecified$/i.test(library.license) ? library.license : '';
        const detected = cliLicense || (licenseText?.match(/MIT License|Apache License[^\r\n]*|GNU (?:LESSER )?GENERAL PUBLIC LICENSE|BSD \d-Clause|Mozilla Public License[^\r\n]*/i)?.[0]) || (licenseText ? `见 ${licenseFile ? (0, path_1.basename)(licenseFile) : '上游许可证文件'}` : '许可证未声明');
        return { name, version: String(library.version || '未知版本'), license: detected, website: typeof library.website === 'string' ? library.website : undefined, installDir, licenseFile, licenseText };
    });
}
async function reproducibleEnvironment(spec, libraries) {
    const version = await runCli(['version', '--format', 'json']);
    const cores = await runCli(['core', 'list', '--format', 'json']);
    let cli = { version: 'unknown' };
    let installedCores = [];
    try {
        cli = JSON.parse(version.stdout);
    }
    catch {
        cli = { raw: version.stdout.trim() };
    }
    try {
        installedCores = JSON.parse(cores.stdout);
    }
    catch {
        installedCores = [];
    }
    return {
        generatedAt: new Date().toISOString(),
        board: { name: spec.board.name, fqbn: spec.board.fqbn },
        arduinoCli: cli,
        installedCores,
        libraries: libraries.map(item => ({ name: item.name, version: item.version, license: item.license, website: item.website })),
        note: 'This manifest records the local toolchain metadata but does not guarantee bit-for-bit reproducible output across operating systems.'
    };
}
function projectCode(brief) {
    const audioFlow = /声音|音量|流水|WS2812|灯带/.test(`${brief.goal}${brief.sensor}${brief.output}`);
    if (audioFlow) {
        return `#include <Adafruit_NeoPixel.h>

// 声音感应流水灯：声音越大，颜色越热烈，并沿灯带滚动
#define SOUND_PIN ${brief.sensorPin}
#define LED_PIN ${brief.outputPin}
#define LED_COUNT 80

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);
const uint16_t FLOW_INTERVAL_MS = 60;
const uint16_t SENSOR_INTERVAL_MS = 20;
const float FADE_RATE = 0.90f;
const uint8_t MIN_BRIGHTNESS = 20;

float smoothedLevel = 0.0f;
uint32_t ledColors[LED_COUNT];
float ledBrightness[LED_COUNT];
uint32_t currentColor = 0;
unsigned long lastSensorUpdate = 0;
unsigned long lastFlowUpdate = 0;

uint32_t paletteColor(int level, uint8_t brightness) {
  // 五档颜色：蓝 -> 浅蓝 -> 蓝紫 -> 紫粉 -> 亮粉
  const uint8_t colors[5][3] = {{0, 40, 255}, {40, 170, 255}, {100, 60, 255}, {220, 30, 180}, {255, 10, 80}};
  level = constrain(level, 0, 4);
  return strip.Color((uint16_t)colors[level][0] * brightness / 255,
                    (uint16_t)colors[level][1] * brightness / 255,
                    (uint16_t)colors[level][2] * brightness / 255);
}

void setup() {
  Serial.begin(115200);
  strip.begin();
  strip.clear();
  strip.setBrightness(255);
  strip.show();
  for (int i = 0; i < LED_COUNT; i++) {
    ledColors[i] = strip.Color(0, 0, 255);
    ledBrightness[i] = 0.0f;
  }
}

void readSoundLevel() {
  int raw = analogRead(SOUND_PIN);
  smoothedLevel = smoothedLevel * 0.82f + raw * 0.18f;
}

void updateColorFromLevel() {
  int band = constrain(map((int)smoothedLevel, 0, 1023, 0, 24), 0, 24);
  currentColor = paletteColor(band / 5, 255);
}

void updateFlowEffect() {
  for (int i = LED_COUNT - 1; i > 0; i--) {
    ledColors[i] = ledColors[i - 1];
    ledBrightness[i] = max((float)MIN_BRIGHTNESS / 255.0f, ledBrightness[i - 1] * FADE_RATE);
  }
  ledColors[0] = currentColor;
  ledBrightness[0] = 0.35f + constrain(smoothedLevel / 1023.0f, 0.0f, 1.0f) * 0.65f;
}

void updateLEDDisplay() {
  for (int i = 0; i < LED_COUNT; i++) {
    uint32_t color = ledColors[i];
    uint8_t r = ((color >> 16) & 0xFF) * ledBrightness[i];
    uint8_t g = ((color >> 8) & 0xFF) * ledBrightness[i];
    uint8_t b = (color & 0xFF) * ledBrightness[i];
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
}

void loop() {
  unsigned long now = millis();
  if (now - lastSensorUpdate >= SENSOR_INTERVAL_MS) {
    lastSensorUpdate = now;
    readSoundLevel();
    updateColorFromLevel();
  }
  if (now - lastFlowUpdate >= FLOW_INTERVAL_MS) {
    lastFlowUpdate = now;
    updateFlowEffect();
    updateLEDDisplay();
  }
}
`;
    }
    const digitalSensor = brief.sensor.includes('数字');
    const ultrasonic = brief.sensor.includes('超声波');
    const neopixel = brief.output.includes('NeoPixel') || brief.output.includes('灯带');
    const buzzer = brief.output.includes('蜂鸣器');
    const header = neopixel ? '#include <Adafruit_NeoPixel.h>\n\n' : '';
    const defines = ultrasonic
        ? `#define TRIG_PIN ${brief.sensorPin}\n#define ECHO_PIN ${brief.outputPin}`
        : `#define SENSOR_PIN ${brief.sensorPin}\n#define OUTPUT_PIN ${brief.outputPin}`;
    const declarations = neopixel
        ? `\nAdafruit_NeoPixel strip(8, OUTPUT_PIN, NEO_GRB + NEO_KHZ800);`
        : '';
    const setup = ultrasonic
        ? `  pinMode(TRIG_PIN, OUTPUT);\n  pinMode(ECHO_PIN, INPUT);`
        : `${digitalSensor ? '  pinMode(SENSOR_PIN, INPUT);\n' : ''}${neopixel ? '  strip.begin();\n  strip.clear();\n  strip.show();' : '  pinMode(OUTPUT_PIN, OUTPUT);'}`;
    const read = ultrasonic
        ? `  digitalWrite(TRIG_PIN, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG_PIN, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(TRIG_PIN, LOW);\n  long duration = pulseIn(ECHO_PIN, HIGH, 30000);\n  int sensorValue = duration == 0 ? 0 : (int)(duration * 0.0343 / 2);`
        : `  int sensorValue = ${digitalSensor ? 'digitalRead(SENSOR_PIN)' : 'analogRead(SENSOR_PIN)'};`;
    const threshold = digitalSensor ? 'HIGH' : ultrasonic ? '30' : '500';
    const output = neopixel
        ? `  int brightness = map(constrain(sensorValue, 0, ${ultrasonic ? '100' : '1023'}), 0, ${ultrasonic ? '100' : '1023'}, 0, 255);\n  strip.setBrightness(brightness);\n  for (int i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, strip.Color(brightness, 0, 255 - brightness));\n  strip.show();`
        : buzzer
            ? `  digitalWrite(OUTPUT_PIN, sensorValue > ${threshold} ? HIGH : LOW);`
            : `  analogWrite(OUTPUT_PIN, map(constrain(sensorValue, 0, 1023), 0, 1023, 0, 255));`;
    return `${header}// 项目目标：${brief.goal}\n// 传感器：${brief.sensor}，输出：${brief.output}\n${defines}${declarations}\n\nvoid setup() {\n  Serial.begin(115200);\n${setup}\n}\n\nvoid loop() {\n${read}\n  Serial.println(sensorValue);\n${output}\n  delay(50);\n}\n`;
}
function createAudioFlowProject(goal) {
    const legacy = {
        goal,
        sensor: '模拟声音传感器', output: 'WS2812 / NeoPixel 灯带',
        sensorPin: 'A0', outputPin: '5', wiringConfirmed: false,
        libraries: ['Adafruit NeoPixel'],
        wiring: ['声音传感器 AO -> Arduino A0', '声音传感器 VCC -> Arduino 5V', '声音传感器 GND -> Arduino GND', 'WS2812 DIN -> Arduino D5', 'WS2812 5V -> 独立稳定 5V 电源', 'WS2812 GND -> 电源 GND 与 Arduino GND 共地'],
        code: ''
    };
    const project = {
        ...legacy,
        spec: (0, workflow_1.normalizeProjectSpec)(undefined, legacy)
    };
    project.code = projectCode(project);
    return project;
}
function createCommonTemplateProject(goal) {
    const make = (sensor, output, sensorPin, outputPin, wiring, code, libraries = []) => {
        const legacy = { goal, sensor, output, sensorPin, outputPin, wiring, libraries, wiringConfirmed: false, code };
        return { ...legacy, spec: (0, workflow_1.normalizeProjectSpec)(undefined, legacy) };
    };
    if (/超声波|HC-?SR04/i.test(goal) && /蜂鸣|报警/.test(goal)) {
        return make('HC-SR04 超声波传感器', '有源蜂鸣器', 'TRIG=D9, ECHO=D10', 'D6', ['HC-SR04 VCC -> Arduino 5V', 'HC-SR04 GND -> Arduino GND', 'HC-SR04 TRIG -> Arduino D9', 'HC-SR04 ECHO -> Arduino D10', '有源蜂鸣器 + -> Arduino D6', '有源蜂鸣器 - -> Arduino GND'], `#define TRIG_PIN 9\n#define ECHO_PIN 10\n#define BUZZER_PIN 6\nconst float ALARM_DISTANCE_CM = 20.0;\n\nfloat readDistanceCm() {\n  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);\n  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);\n  digitalWrite(TRIG_PIN, LOW);\n  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);\n  return duration == 0 ? -1.0 : duration * 0.0343 / 2.0;\n}\n\nvoid setup() {\n  Serial.begin(115200); pinMode(TRIG_PIN, OUTPUT); pinMode(ECHO_PIN, INPUT); pinMode(BUZZER_PIN, OUTPUT);\n}\n\nvoid loop() {\n  float distance = readDistanceCm();\n  bool alarm = distance > 0 && distance <= ALARM_DISTANCE_CM;\n  digitalWrite(BUZZER_PIN, alarm ? HIGH : LOW);\n  Serial.println(distance); delay(60);\n}\n`);
    }
    if (/(双光敏|两个光敏|左右光敏|追光|向日葵)/i.test(goal) && /(舵机|servo|转向)/i.test(goal)) {
        return make('左右两个光敏传感器', 'SG90/MG90S 舵机追光机构', 'LEFT=A0, RIGHT=A1', 'D9', ['左光敏模块 AO -> Arduino A0', '左光敏模块 VCC -> Arduino 5V', '左光敏模块 GND -> Arduino GND', '右光敏模块 AO -> Arduino A1', '右光敏模块 VCC -> Arduino 5V', '右光敏模块 GND -> Arduino GND', '舵机信号线 -> Arduino D9', '舵机 VCC -> 外部稳定 5V 电源', '舵机 GND -> 外部电源 GND 与 Arduino GND 共地', '两个光敏传感器之间安装遮光隔板'], `#include <Servo.h>\n#define LEFT_LDR_PIN A0\n#define RIGHT_LDR_PIN A1\n#define SERVO_PIN 9\n\nServo trackerServo;\nfloat leftFiltered = 0.0f;\nfloat rightFiltered = 0.0f;\nint servoAngle = 90;\nconst int DEAD_BAND = 35;\nconst int MIN_ANGLE = 10;\nconst int MAX_ANGLE = 170;\nconst int STEP_DEGREES = 1;\nconst bool SERVO_REVERSED = false;\nunsigned long lastUpdate = 0;\n\nvoid setup() {\n  Serial.begin(115200);\n  trackerServo.attach(SERVO_PIN);\n  trackerServo.write(servoAngle);\n  leftFiltered = analogRead(LEFT_LDR_PIN);\n  rightFiltered = analogRead(RIGHT_LDR_PIN);\n}\n\nvoid loop() {\n  unsigned long now = millis();\n  if (now - lastUpdate < 40) return;\n  lastUpdate = now;\n\n  leftFiltered = leftFiltered * 0.75f + analogRead(LEFT_LDR_PIN) * 0.25f;\n  rightFiltered = rightFiltered * 0.75f + analogRead(RIGHT_LDR_PIN) * 0.25f;\n  int difference = (int)(leftFiltered - rightFiltered);\n\n  if (abs(difference) > DEAD_BAND) {\n    int direction = difference > 0 ? -1 : 1;\n    if (SERVO_REVERSED) direction = -direction;\n    servoAngle = constrain(servoAngle + direction * STEP_DEGREES, MIN_ANGLE, MAX_ANGLE);\n    trackerServo.write(servoAngle);\n  }\n\n  Serial.print("left="); Serial.print(leftFiltered, 0);\n  Serial.print(" right="); Serial.print(rightFiltered, 0);\n  Serial.print(" difference="); Serial.print(difference);\n  Serial.print(" angle="); Serial.println(servoAngle);\n}\n`, ['Servo']);
    }
    if (/光敏|光照|LDR/i.test(goal) && /灯|LED/i.test(goal)) {
        return make('光敏电阻模块', 'LED', 'A0', 'D9', ['光敏模块 AO -> Arduino A0', '光敏模块 VCC -> Arduino 5V', '光敏模块 GND -> Arduino GND', 'LED 正极 -> 220Ω 电阻 -> Arduino D9', 'LED 负极 -> Arduino GND'], `#define LIGHT_PIN A0\n#define LED_PIN 9\nconst int DARK_THRESHOLD = 500;\nvoid setup() { Serial.begin(115200); pinMode(LED_PIN, OUTPUT); }\nvoid loop() {\n  int light = analogRead(LIGHT_PIN);\n  int brightness = light < DARK_THRESHOLD ? map(light, 0, DARK_THRESHOLD, 255, 0) : 0;\n  analogWrite(LED_PIN, constrain(brightness, 0, 255));\n  Serial.println(light); delay(30);\n}\n`);
    }
    if (/人体|PIR|HC-?SR501/i.test(goal) && /灯|LED|报警/.test(goal)) {
        return make('PIR 人体红外传感器', /蜂鸣|报警/.test(goal) ? '有源蜂鸣器' : 'LED', 'D2', 'D8', ['PIR VCC -> Arduino 5V', 'PIR GND -> Arduino GND', 'PIR OUT -> Arduino D2', `${/蜂鸣|报警/.test(goal) ? '有源蜂鸣器 +' : 'LED 控制端'} -> Arduino D8`, '输出模块 GND -> Arduino GND'], `#define PIR_PIN 2\n#define OUTPUT_PIN 8\nunsigned long activeUntil = 0;\nvoid setup() { Serial.begin(115200); pinMode(PIR_PIN, INPUT); pinMode(OUTPUT_PIN, OUTPUT); }\nvoid loop() {\n  if (digitalRead(PIR_PIN) == HIGH) activeUntil = millis() + 5000UL;\n  bool active = (long)(activeUntil - millis()) > 0;\n  digitalWrite(OUTPUT_PIN, active ? HIGH : LOW);\n  Serial.println(active ? "motion" : "clear"); delay(50);\n}\n`);
    }
    if (/土壤|湿度/.test(goal) && /水泵|浇水|继电器/.test(goal)) {
        return make('土壤湿度传感器', '继电器水泵', 'A0', 'D7', ['土壤湿度模块 AO -> Arduino A0', '土壤湿度模块 VCC -> Arduino 5V', '土壤湿度模块 GND -> Arduino GND', '继电器 IN -> Arduino D7', '继电器 VCC -> Arduino 5V', '继电器 GND -> Arduino GND', '水泵使用独立电源并通过继电器触点供电，禁止从 Arduino 5V 驱动水泵'], `#define SOIL_PIN A0\n#define RELAY_PIN 7\nconst int DRY_THRESHOLD = 650;\nconst bool RELAY_ACTIVE_LOW = true;\nvoid setPump(bool on) { digitalWrite(RELAY_PIN, (on ^ RELAY_ACTIVE_LOW) ? HIGH : LOW); }\nvoid setup() { Serial.begin(115200); pinMode(RELAY_PIN, OUTPUT); setPump(false); }\nvoid loop() {\n  int moisture = analogRead(SOIL_PIN);\n  setPump(moisture >= DRY_THRESHOLD);\n  Serial.println(moisture); delay(500);\n}\n`);
    }
    if (/(DHT11|DHT22|温湿度)/i.test(goal) && /OLED|SSD1306/i.test(goal)) {
        const dhtType = /DHT22/i.test(goal) ? 'DHT22' : 'DHT11';
        return make(`${dhtType} 温湿度传感器`, '0.96寸 I2C OLED', 'DATA=D2', 'SDA=A4, SCL=A5', [`${dhtType} VCC -> Arduino 5V`, `${dhtType} GND -> Arduino GND`, `${dhtType} DATA -> Arduino D2`, 'OLED VCC -> Arduino 5V', 'OLED GND -> Arduino GND', 'OLED SDA -> Arduino A4', 'OLED SCL -> Arduino A5'], `#include <DHT.h>\n#include <Wire.h>\n#include <Adafruit_GFX.h>\n#include <Adafruit_SSD1306.h>\n#define DHT_PIN 2\n#define DHT_TYPE ${dhtType}\nDHT dht(DHT_PIN, DHT_TYPE);\nAdafruit_SSD1306 display(128, 64, &Wire, -1);\nvoid setup() {\n  Serial.begin(115200); dht.begin();\n  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) while (true) {}\n  display.setTextColor(SSD1306_WHITE);\n}\nvoid loop() {\n  float humidity = dht.readHumidity(); float temperature = dht.readTemperature();\n  if (!isnan(humidity) && !isnan(temperature)) {\n    display.clearDisplay(); display.setTextSize(2); display.setCursor(0, 8);\n    display.print(temperature, 1); display.println(" C"); display.print(humidity, 1); display.println(" %"); display.display();\n    Serial.print(temperature); Serial.print(','); Serial.println(humidity);\n  }\n  delay(2000);\n}\n`, ['DHT sensor library', 'Adafruit GFX Library', 'Adafruit SSD1306']);
    }
    if (/(DHT11|DHT22|温湿度)/i.test(goal) && /风扇|继电器|降温/.test(goal)) {
        const dhtType = /DHT22/i.test(goal) ? 'DHT22' : 'DHT11';
        return make(`${dhtType} 温湿度传感器`, '继电器风扇', 'D2', 'D7', [`${dhtType} VCC -> Arduino 5V`, `${dhtType} GND -> Arduino GND`, `${dhtType} DATA -> Arduino D2`, '继电器 IN -> Arduino D7', '继电器 VCC -> Arduino 5V', '继电器 GND -> Arduino GND', '风扇使用独立电源并通过继电器触点供电'], `#include <DHT.h>\n#define DHT_PIN 2\n#define DHT_TYPE ${dhtType}\n#define RELAY_PIN 7\nDHT dht(DHT_PIN, DHT_TYPE);\nconst float START_TEMPERATURE = 28.0;\nconst float STOP_TEMPERATURE = 26.0;\nbool fanOn = false;\nvoid setup() { Serial.begin(115200); dht.begin(); pinMode(RELAY_PIN, OUTPUT); digitalWrite(RELAY_PIN, HIGH); }\nvoid loop() {\n  float temperature = dht.readTemperature();\n  if (!isnan(temperature)) {\n    if (temperature >= START_TEMPERATURE) fanOn = true;\n    else if (temperature <= STOP_TEMPERATURE) fanOn = false;\n    digitalWrite(RELAY_PIN, fanOn ? LOW : HIGH); Serial.println(temperature);\n  }\n  delay(2000);\n}\n`, ['DHT sensor library']);
    }
    if (/L298N|直流电机|电机正反转/i.test(goal)) {
        return make('控制逻辑/电位器', 'L298N 直流电机', 'A0', 'ENA=D5, IN1=D7, IN2=D8', ['L298N ENA -> Arduino D5', 'L298N IN1 -> Arduino D7', 'L298N IN2 -> Arduino D8', 'L298N OUT1/OUT2 -> 直流电机', 'L298N 电机电源端 -> 独立电机电源', 'L298N GND -> 电机电源 GND 与 Arduino GND 共地', '电位器中间脚 -> Arduino A0', '电位器两端 -> Arduino 5V 和 GND'], `#define SPEED_PIN 5\n#define IN1_PIN 7\n#define IN2_PIN 8\n#define CONTROL_PIN A0\nvoid setup() { pinMode(SPEED_PIN, OUTPUT); pinMode(IN1_PIN, OUTPUT); pinMode(IN2_PIN, OUTPUT); }\nvoid loop() {\n  int control = analogRead(CONTROL_PIN);\n  int signedSpeed = map(control, 0, 1023, -255, 255);\n  if (abs(signedSpeed) < 20) { digitalWrite(IN1_PIN, LOW); digitalWrite(IN2_PIN, LOW); analogWrite(SPEED_PIN, 0); }\n  else {\n    digitalWrite(IN1_PIN, signedSpeed > 0 ? HIGH : LOW);\n    digitalWrite(IN2_PIN, signedSpeed > 0 ? LOW : HIGH);\n    analogWrite(SPEED_PIN, abs(signedSpeed));\n  }\n  delay(20);\n}\n`);
    }
    if (/按钮|按键/.test(goal) && /灯|LED/i.test(goal)) {
        return make('按键', 'LED', 'D2', 'D13', ['按键一端 -> Arduino D2', '按键另一端 -> Arduino GND（使用内部上拉）', 'LED 正极 -> 220Ω 电阻 -> Arduino D13', 'LED 负极 -> Arduino GND'], `#define BUTTON_PIN 2\n#define LED_PIN 13\nbool ledOn = false;\nbool lastReading = HIGH;\nunsigned long changedAt = 0;\nvoid setup() { pinMode(BUTTON_PIN, INPUT_PULLUP); pinMode(LED_PIN, OUTPUT); }\nvoid loop() {\n  bool reading = digitalRead(BUTTON_PIN);\n  if (reading != lastReading && millis() - changedAt > 30) {\n    changedAt = millis(); lastReading = reading;\n    if (reading == LOW) { ledOn = !ledOn; digitalWrite(LED_PIN, ledOn); }\n  }\n}\n`);
    }
    if (/舵机|servo/i.test(goal)) {
        const angle = Math.min(180, Math.max(0, Number(goal.match(/(\d+)\s*度/)?.[1] || 90)));
        return make('控制输入/定时逻辑', '舵机', 'A0', 'D9', ['舵机信号线 -> Arduino D9', '舵机 VCC -> 外部稳定 5V 电源', '舵机 GND -> 外部电源 GND 与 Arduino GND 共地', '可选电位器中间脚 -> Arduino A0', '电位器两端 -> Arduino 5V 和 GND'], `#include <Servo.h>\n#define SERVO_PIN 9\n#define CONTROL_PIN A0\nServo motor;\nvoid setup() { Serial.begin(115200); motor.attach(SERVO_PIN); motor.write(${angle}); }\nvoid loop() {\n  int raw = analogRead(CONTROL_PIN);\n  int angle = map(raw, 0, 1023, 0, 180);\n  motor.write(angle); Serial.println(angle); delay(20);\n}\n`, ['Servo']);
    }
    return undefined;
}
function wiringChecklist(brief) {
    if (brief.wiring?.length)
        return brief.wiring;
    if (brief.sensor.includes('超声波')) {
        return [
            `超声波 TRIG 接到 ${brief.sensorPin}`,
            `超声波 ECHO 接到 ${brief.outputPin}`,
            '所有模块 GND 与开发板 GND 共地',
            'VCC 电压符合模块标注',
            `${brief.output} 控制线按代码连接并确认极性`
        ];
    }
    return [
        `传感器信号线接到 ${brief.sensorPin}`,
        `${brief.output} 控制线接到 ${brief.outputPin}`,
        '所有模块 GND 与开发板 GND 共地',
        'VCC 电压符合模块标注',
        brief.output.includes('灯带') ? '灯带电流较大时使用独立供电，并保持共地' : '输出部件的正负极或方向已确认'
    ];
}
async function revealError(d) {
    if (!d.file || !d.line || !(0, fs_1.existsSync)(d.file))
        return;
    const doc = await plugin.workspace.openTextDocument(d.file);
    const editor = await plugin.window.showTextDocument(doc);
    const pos = new plugin.Position(Math.max(0, d.line - 1), Math.max(0, (d.column || 1) - 1));
    editor.selection = new plugin.Selection(pos, pos);
    editor.revealRange(new plugin.Range(pos, pos), plugin.TextEditorRevealType.InCenter);
}
async function revealSemicolonCandidate(d) {
    if (!d.file || !d.line || !(0, fs_1.existsSync)(d.file))
        return;
    const doc = await plugin.workspace.openTextDocument(d.file);
    const target = findMissingSemicolonLine(doc, d.line);
    if (target === undefined) {
        await revealError(d);
        return;
    }
    const editor = await plugin.window.showTextDocument(doc);
    const pos = new plugin.Position(target, doc.lineAt(target).text.length);
    editor.selection = new plugin.Selection(pos, pos);
    editor.revealRange(new plugin.Range(pos, pos), plugin.TextEditorRevealType.InCenter);
    plugin.window.showInformationMessage(`第 ${d.line} 行是错误暴露位置，建议修改第 ${target + 1} 行。`);
}
async function addRecord(context, record, refresh) {
    const records = context.workspaceState.get('changeRecords', []);
    await context.workspaceState.update('changeRecords', [record, ...records].slice(0, 20));
    refresh();
}
function findMissingSemicolonLine(doc, reportedLine) {
    let inBlockComment = false;
    for (let index = Math.min(doc.lineCount - 1, reportedLine - 2); index >= 0; index--) {
        const raw = doc.lineAt(index).text;
        const value = raw.trim();
        if (!value)
            continue;
        if (value.endsWith('*/')) {
            inBlockComment = true;
            continue;
        }
        if (inBlockComment) {
            if (value.startsWith('/*'))
                inBlockComment = false;
            continue;
        }
        if (value.startsWith('//') || value.startsWith('/*') || value.startsWith('*') || value.startsWith('#'))
            continue;
        const code = value.replace(/\/\/.*$/, '').trim();
        if (!code)
            continue;
        if (/[;{},:]$/.test(code))
            continue;
        if (/^(if|for|while|switch|else|do)\b/.test(code))
            continue;
        return index;
    }
    return undefined;
}
async function fixSemicolon(d, context, refresh) {
    if (!d.file || !d.line || !(0, fs_1.existsSync)(d.file))
        return;
    const doc = await plugin.workspace.openTextDocument(d.file);
    const target = findMissingSemicolonLine(doc, d.line);
    if (target === undefined) {
        plugin.window.showWarningMessage(`编译器在第 ${d.line} 行暴露错误，但 Agent 没有找到可以安全补分号的上一条语句。请手动检查附近代码。`);
        return;
    }
    const original = doc.lineAt(target).text;
    if (/[;{}]\s*(\/\/.*)?$/.test(original.trim())) {
        plugin.window.showWarningMessage('Agent 没有找到可以安全补分号的位置，请手动检查错误行附近。');
        return;
    }
    const edit = new plugin.WorkspaceEdit();
    edit.insert(doc.uri, new plugin.Position(target, original.length), ';');
    if (!(await plugin.workspace.applyEdit(edit))) {
        plugin.window.showErrorMessage('自动修改失败。');
        return;
    }
    await doc.save();
    await addRecord(context, { time: new Date().toLocaleString('zh-CN'), file: d.file, reason: `第 ${target + 1} 行补充分号`, before: original, after: `${original};` }, refresh);
    const selected = await plugin.window.showInformationMessage(`编译器在第 ${d.line} 行暴露错误，实际漏分号的是第 ${target + 1} 行。已补上分号并保存修改记录。`, '重新编译');
    if (selected === '重新编译')
        await plugin.commands.executeCommand('arduinoFirstRunAgent.compile');
}
async function fixLibrary(d, context, refresh) {
    if (!d.library) {
        plugin.window.showWarningMessage('暂时无法确定对应库，请打开 Arduino IDE 的库管理器搜索头文件名称。');
        return;
    }
    plugin.window.showInformationMessage(`正在安装 ${d.library}…`);
    const installed = await runCli(['lib', 'install', d.library]);
    if (installed.code !== 0) {
        plugin.window.showErrorMessage(`安装失败：${installed.stderr || installed.stdout}`);
        return;
    }
    if (d.file && d.header && d.correctedHeader && d.header !== d.correctedHeader && (0, fs_1.existsSync)(d.file)) {
        const doc = await plugin.workspace.openTextDocument(d.file);
        const before = doc.getText();
        const after = before.replace(d.header, d.correctedHeader);
        const edit = new plugin.WorkspaceEdit();
        edit.replace(doc.uri, new plugin.Range(doc.positionAt(0), doc.positionAt(before.length)), after);
        await plugin.workspace.applyEdit(edit);
        await doc.save();
        await addRecord(context, { time: new Date().toLocaleString('zh-CN'), file: d.file, reason: `安装 ${d.library} 并修正头文件引用`, before: `#include <${d.header}>`, after: `#include <${d.correctedHeader}>` }, refresh);
    }
    const selected = await plugin.window.showInformationMessage(`${d.library} 已安装，引用已检查，并保存修改记录。`, '重新编译');
    if (selected === '重新编译')
        await plugin.commands.executeCommand('arduinoFirstRunAgent.compile');
}
async function showDiagnosis(log, context, refresh) {
    const d = diagnosis(log);
    const actions = [];
    if (d.fixKind === 'semicolon')
        actions.push('帮我修复');
    if (d.fixKind === 'library')
        actions.push(d.library ? '自动安装并修正' : '打开库管理器');
    if (d.file && d.line)
        actions.push(d.fixKind === 'semicolon' ? '跳到建议修改行' : '跳到错误行');
    const selected = await plugin.window.showErrorMessage(`${d.title}：${d.advice}`, ...actions);
    if (selected === '跳到错误行')
        await revealError(d);
    if (selected === '跳到建议修改行')
        await revealSemicolonCandidate(d);
    if (selected === '帮我修复')
        await fixSemicolon(d, context, refresh);
    if (selected === '自动安装并修正')
        await fixLibrary(d, context, refresh);
    if (selected === '打开库管理器')
        await plugin.commands.executeCommand('arduino.libraryManager');
}
function scanSummary(stdout) {
    try {
        const data = JSON.parse(stdout);
        const usb = (data.detected_ports || []).filter(item => item.port?.properties?.vid);
        if (!usb.length)
            return { env: '未发现 USB 串口', advice: '尚未检测到 USB 主板。请检查数据线、驱动和接口。' };
        const lines = usb.map(item => {
            const p = item.port;
            const board = item.matching_boards?.[0];
            return `${p.address} · ${p.protocol_label || 'USB 串口'} · VID ${p.properties?.vid} PID ${p.properties?.pid}${board ? ` · ${board.name}` : ''}`;
        });
        const unresolved = usb.some(item => !item.matching_boards?.length);
        return {
            env: `已连接\n${lines.join('\n')}`,
            advice: unresolved ? '已检测到主板串口，但 CH340 无法自动报告具体板型。请在 Arduino IDE 顶部手动选择实际板型，例如 Arduino Uno 或 Nano。' : '主板和串口已识别，可以继续编译。'
        };
    }
    catch {
        return { env: stdout.trim() || '扫描失败', advice: '无法解析扫描结果，请重新扫描。' };
    }
}
const uploadBoards = [
    { label: 'Arduino Uno', fqbn: 'arduino:avr:uno' },
    { label: 'Arduino Nano', description: 'CH340 Nano 或兼容板', fqbn: 'arduino:avr:nano' },
    { label: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega' },
    { label: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo' }
];
function compactUploadError(result, port, fqbn) {
    const raw = `${result.stderr}\n${result.stdout}`.trim();
    const normalized = raw.replace(/(?:Error:\s*timeout\s*){2,}/gi, 'Error: timeout; ');
    if (/stk500v2_getsync|not in sync|programmer is not responding/i.test(normalized)) {
        return `${port} 可以打开，但开发板没有回应 ${fqbn} 对应的上传协议。最常见原因是开发板型号选择错误；CH340 不能自动识别板型，请重新确认实物板型。`;
    }
    if (/unable to open port|access is denied|resource busy|ser_open/i.test(normalized)) {
        return `无法独占打开 ${port}。端口确实存在，但上传瞬间被串口监视器或另一个上传进程占用。请关闭串口监视器后重试。`;
    }
    if (/timed out|timeout|ETIMEDOUT/i.test(normalized)) {
        return `上传等待超时。端口为 ${port}，板型为 ${fqbn}。Agent 已停止本次任务，避免后台残留进程继续占用串口。`;
    }
    return normalized.slice(-2000) || '上传失败，未收到可识别的工具日志。';
}
function uploadTargets(stdout) {
    try {
        const data = JSON.parse(stdout);
        return (data.detected_ports || [])
            .filter(item => item.port?.address && item.port?.properties?.vid)
            .map(item => ({
            address: item.port.address,
            label: item.port.label || item.port.address,
            fqbn: item.matching_boards?.[0]?.fqbn,
            boardName: item.matching_boards?.[0]?.name
        }));
    }
    catch {
        return [];
    }
}
function workflowDashboardHtml(state, brief, records, draftGoal = '', draftBeginner = true, showComposer = false) {
    const aiConfiguration = plugin.workspace.getConfiguration('arduinoAgent');
    const aiProvider = aiConfiguration.get('provider', 'ollama');
    const aiModel = aiConfiguration.get('codeModel', aiConfiguration.get('model', '未配置'));
    const aiServiceLabel = aiProvider === 'ollama' ? '本地 Ollama' : aiProvider === 'openai' ? 'OpenAI 云端' : '其他 AI 服务';
    const spec = state.spec || brief?.spec;
    const action = (0, workflow_1.nextAction)(state);
    const phases = [
        ['plan-review', '方案'], ['generating', '代码'], ['compiling', '编译'], ['wiring', '接线'], ['device', '设备'], ['upload-ready', '上传'], ['observing', '效果'], ['completed', '完成']
    ];
    const phaseOrder = phases.map(([id]) => id);
    const currentIndex = phaseOrder.indexOf(state.phase);
    const stepHtml = phases.map(([id, label], index) => {
        const kind = state.phase === id ? 'current' : currentIndex >= 0 && index < currentIndex ? 'done' : '';
        return `<div class="step ${kind}"><span>${kind === 'done' ? '✓' : index + 1}</span><small>${label}</small></div>`;
    }).join('');
    const components = spec?.components.map(component => {
        const contracts = (0, hardwareContracts_1.contractsFor)(`${component.name} ${component.model || ''}`);
        const sources = contracts.flatMap(contract => contract.evidence).map(item => `<a href="${escapeHtml(item.url)}" title="${escapeHtml(item.level)}">${escapeHtml(item.title)}</a>`).join(' · ');
        return `<div class="component"><div class="mini"><b>${escapeHtml(component.name)}</b><span>${escapeHtml(component.role)} · ×${component.quantity}${component.interface ? ` · ${escapeHtml(component.interface)}` : ''}</span></div><small class="source ${sources ? '' : 'unknown'}">${sources || '无已验证硬件契约，请按具体型号资料人工确认端子'}</small></div>`;
    }).join('') || '<div class="empty">生成方案后显示元件</div>';
    // Never silently hide connections: the omitted wire may be a power or ground
    // connection, which is particularly dangerous in a beginner-facing guide.
    const connections = spec?.connections.map(connection => `<div class="connection"><span>${escapeHtml(connection.componentName)} ${escapeHtml(connection.sourcePin)}</span><b>→</b><span>${escapeHtml(connection.target)} ${escapeHtml(connection.targetPin)}</span><i class="${connection.confirmed ? 'ok' : ''}">${connection.confirmed ? '已确认' : '待确认'}</i></div>`).join('') || '<div class="empty">生成方案后显示接线</div>';
    const acceptance = spec?.acceptance.map(item => `<li class="${item.passed ? 'passed' : ''}">${item.passed ? '✓' : '○'} ${escapeHtml(item.description)}<small>${escapeHtml(item.evidence)}</small></li>`).join('') || '<li>等待生成验收标准</li>';
    const risks = spec?.risks.length ? spec.risks.map(risk => `<li>${escapeHtml(risk)}</li>`).join('') : '<li>暂无已记录风险</li>';
    const visibleEvidence = state.evidence.filter((item, index, all) => all.findIndex(candidate => candidate.tool === item.tool && candidate.ok === item.ok && candidate.summary === item.summary) === index).slice(0, 8);
    const evidence = visibleEvidence.map(item => `<div class="evidence ${item.ok ? 'good' : 'bad'}"><div class="evidence-main"><b>${item.ok ? '通过' : '失败'} · ${escapeHtml(item.tool)}</b><span>${escapeHtml(item.summary)}</span><time>${new Date(item.at).toLocaleString('zh-CN')}</time></div>${item.detail ? `<details><summary>查看具体原因</summary><p>${escapeHtml(item.detail)}</p></details>` : ''}</div>`).join('') || '<div class="empty">工具执行后会在这里留下证据</div>';
    const evidenceRecovery = state.status === 'error' ? `<div class="evidence-actions"><button class="primary" data-command="arduinoFirstRunAgent.retry">保留当前需求并重试（自动修复）</button><button data-message="editHardware">修改硬件选择</button><button data-message="editGoal">修改需求</button><button data-message="showError">查看具体技术错误</button></div>` : '';
    const history = records.slice(0, 5).map((record, index) => `<button class="history" data-message="record" data-index="${index}">${escapeHtml(record.reason)}<small>${escapeHtml(record.time)}</small></button>`).join('') || '<div class="empty">暂无代码修改</div>';
    const verification = (0, workflow_1.verificationSummary)(state);
    const verificationLabels = [['wiring', '结构化接线'], ['static', '代码静态检查'], ['compile', '目标板编译'], ['simulation', '仿真'], ['physical', '实物验证']];
    const statusText = { passed: '通过', failed: '失败', 'not-run': '尚未验证', unavailable: '当前不可用' };
    const confidence = verificationLabels.map(([key, label]) => `<div class="confidence ${verification[key]}"><b>${escapeHtml(label)}</b><span>${statusText[verification[key]]}</span></div>`).join('');
    const libraries = state.installedLibraries?.length ? state.installedLibraries.map(item => `<div class="mini"><b>${escapeHtml(item.name)} ${escapeHtml(item.version)}</b><span class="${/未知|未声明|失败/.test(item.license) ? 'license-warning' : ''}">${item.website ? `<a href="${escapeHtml(item.website)}">${escapeHtml(item.license)}</a>` : escapeHtml(item.license)}</span></div>`).join('') : '<div class="empty">尚未安装或查询代码库</div>';
    const primary = action.command ? `<button class="primary" data-command="${escapeHtml(action.command)}">${escapeHtml(action.label)}</button>` : `<button class="primary" disabled>${escapeHtml(action.label)}</button>`;
    const compilePassed = state.evidence.some(item => item.tool === 'compiler' && item.ok);
    const contextualActions = [
        brief || spec ? '<button data-command="arduinoFirstRunAgent.showWiring">查看接线</button>' : '',
        state.projectFile && spec && compilePassed ? '<button data-command="arduinoFirstRunAgent.simulate">可选仿真</button>' : '',
        state.projectFile && spec && compilePassed ? '<button data-command="arduinoFirstRunAgent.exportCommunity">导出社区包</button>' : '',
        '<button data-command="arduinoFirstRunAgent.openSettings">AI设置</button>',
        '<button data-command="arduinoFirstRunAgent.openStartupSettings">启动设置</button>',
        '<button data-command="arduinoFirstRunAgent.testAi">测试AI</button>'
    ].filter(Boolean).join('');
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{color-scheme:light dark;--bg:var(--vscode-editor-background,#f5f7fb);--panel:var(--vscode-sideBar-background,#fff);--text:var(--vscode-foreground,#172033);--muted:var(--vscode-descriptionForeground,#687386);--line:var(--vscode-panel-border,#dce2ec);--accent:var(--vscode-button-background,#2563eb);--danger:var(--vscode-errorForeground,#c2413b);--success:#17845b}
  *{box-sizing:border-box}body{margin:0;padding:18px;font-family:var(--vscode-font-family,"Microsoft YaHei",sans-serif);background:var(--bg);color:var(--text);font-size:13px}.header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.eyebrow{font-size:11px;color:var(--muted);letter-spacing:.08em}.header h1{font-size:20px;margin:5px 0}.badge{padding:5px 9px;border-radius:999px;background:color-mix(in srgb,var(--accent) 15%,transparent);color:var(--accent);font-weight:700}.composer{margin:14px 0;padding:16px;background:var(--panel);border:1px solid var(--line);border-radius:12px}.composer h2{margin:0 0 5px;font-size:16px}.composer .hint{margin:0 0 12px;color:var(--muted);line-height:1.5}.mode-row{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:10px}.mode{display:block;border:1px solid var(--line);border-radius:9px;padding:10px;cursor:pointer}.mode:has(input:checked){border-color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,transparent)}.mode b,.mode span{display:block}.mode span{margin-top:3px;color:var(--muted);font-size:12px}.composer textarea{display:block;width:100%;min-height:180px;resize:vertical;padding:12px;border:1px solid var(--line);border-radius:9px;background:var(--vscode-input-background,var(--bg));color:var(--vscode-input-foreground,var(--text));font:inherit;line-height:1.6}.composer-footer{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}.composer-footer span{color:var(--muted);font-size:12px}.status{margin:14px 0;padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}.status.error{border-color:var(--danger)}.status strong{display:block;font-size:15px;margin-bottom:4px}.status p{margin:0;color:var(--muted);line-height:1.6}.steps{display:grid;grid-template-columns:repeat(8,1fr);gap:4px;margin:16px 0}.step{text-align:center;color:var(--muted)}.step span{display:grid;place-items:center;width:26px;height:26px;margin:auto;border:1px solid var(--line);border-radius:50%;background:var(--panel)}.step small{display:block;margin-top:5px}.step.current span{background:var(--accent);border-color:var(--accent);color:white}.step.done span{background:var(--success);border-color:var(--success);color:white}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}button{font:inherit;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--text);padding:8px 11px;cursor:pointer}button.primary{background:var(--accent);border-color:var(--accent);color:var(--vscode-button-foreground,#fff);font-weight:700}button:disabled{opacity:.55;cursor:default}.grid{display:grid;grid-template-columns:1fr;gap:12px}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:13px;min-width:0}.card.wide{grid-column:auto}.card h2{font-size:14px;margin:0 0 10px}.mini{display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}.mini span,.empty{color:var(--muted)}.license-warning{color:var(--danger)!important;font-weight:700}.component .source{display:block;padding:0 0 8px;color:var(--muted);line-height:1.5}.component .source.unknown{color:var(--danger)}.component a{color:var(--accent)}.confidence{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line)}.confidence.passed span{color:var(--success);font-weight:700}.confidence.failed span{color:var(--danger);font-weight:700}.confidence.not-run span,.confidence.unavailable span{color:var(--muted)}.connection{display:grid;grid-template-columns:1fr 22px 1fr auto;gap:7px;align-items:center;padding:7px 0;border-bottom:1px solid var(--line)}.connection i{font-style:normal;color:var(--muted);font-size:11px}.connection i.ok{color:var(--success)}ul{padding:0;margin:0;list-style:none}li{padding:6px 0;border-bottom:1px solid var(--line)}li small{float:right;color:var(--muted)}li.passed{color:var(--success)}.evidence{padding:8px 0;border-bottom:1px solid var(--line)}.evidence-main{display:grid;grid-template-columns:auto 1fr auto;gap:9px}.evidence.good b{color:var(--success)}.evidence.bad b{color:var(--danger)}.evidence time{font-size:11px;color:var(--muted)}.evidence details{margin:7px 0 0;padding:8px 10px;border-radius:7px;background:color-mix(in srgb,var(--danger) 7%,transparent)}.evidence summary{cursor:pointer;font-weight:700}.evidence details p{white-space:pre-wrap;line-height:1.6;margin:7px 0 0;color:var(--muted)}.evidence-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.history{display:flex;width:100%;justify-content:space-between;text-align:left;border:0;border-bottom:1px solid var(--line);border-radius:0}.history small{color:var(--muted)}@media(max-width:760px){.mode-row{grid-template-columns:1fr}.steps{grid-template-columns:repeat(4,1fr)}.connection{grid-template-columns:1fr 18px 1fr}.connection i{display:none}.evidence-main{grid-template-columns:1fr}.evidence time{display:none}}
  .header-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.dashboard-close{border-color:var(--accent);color:var(--accent);font-weight:700;white-space:nowrap}@media(max-width:760px){.header{display:block}.header-actions{justify-content:flex-start;margin-top:8px}}
  </style></head><body><div class="header"><div><div class="eyebrow">ARDUINO PROJECT AGENT</div><h1>${escapeHtml(spec?.goal || brief?.goal || draftGoal || '开始一个新项目')}</h1></div><div class="header-actions"><span class="badge">${escapeHtml((0, workflow_1.phaseLabel)(state.phase))}</span><button class="dashboard-close" data-command="arduinoFirstRunAgent.toggleDashboard">◀ 收起 Agent 看板</button></div></div>
  ${showComposer ? `<section class="composer"><h2>描述你想做的 Arduino 项目</h2><p class="hint">所有输入都留在项目看板中。内容可以写得很长，Agent 会保存并用于失败后的继续重试。</p><div class="mode-row"><label class="mode"><input type="radio" name="projectMode" value="expert" ${draftBeginner ? '' : 'checked'}><b>我知道要用哪些硬件</b><span>填写模块、数量、引脚和期望效果</span></label><label class="mode"><input type="radio" name="projectMode" value="beginner" ${draftBeginner ? 'checked' : ''}><b>先帮我选择硬件</b><span>只描述效果，Agent 会逐步提供不同选项</span></label></div><textarea id="projectGoal" placeholder="例如：我想做一个花盆，土壤干了自动浇水，并用灯光提醒……">${escapeHtml(draftGoal)}</textarea><div class="composer-footer"><span id="goalCount">${draftGoal.length} 字</span><button id="startProject" class="primary">生成方案</button></div></section>` : ''}
  <div class="status ${state.status === 'error' ? 'error' : ''}"><strong>${escapeHtml(state.message)}</strong><p>${state.error ? escapeHtml(state.error) : `状态：${escapeHtml(state.status)} · 版本 ${state.revision}`}</p></div><div class="steps">${stepHtml}</div><div class="actions">${primary}${contextualActions}</div>
  <div class="grid"><section class="card"><h2>项目、主板与 AI</h2><div class="mini"><b>AI 服务</b><span>${escapeHtml(aiServiceLabel)}</span></div><div class="mini"><b>当前模型</b><span>${escapeHtml(aiModel)}</span></div><div class="mini"><b>开发板</b><span>${escapeHtml(spec?.board.name || '待确认')}</span></div><div class="mini"><b>编译目标</b><span>${escapeHtml(spec?.board.fqbn || '待生成')}</span></div><div class="mini"><b>工程文件</b><span>${escapeHtml(state.projectFile || brief?.projectFile || '尚未保存')}</span></div></section><section class="card"><h2>可信度等级</h2>${confidence}</section><section class="card"><h2>元件清单与依据</h2>${components}</section>
  <section class="card"><h2>代码库版本与许可证</h2>${libraries}</section><section class="card wide"><h2>接线</h2>${connections}</section><section class="card"><h2>验收标准</h2><ul>${acceptance}</ul></section><section class="card"><h2>风险与边界</h2><ul>${risks}</ul></section><section class="card wide"><h2>验证证据</h2>${evidence}${evidenceRecovery}</section><section class="card wide"><h2>修改历史</h2>${history}</section></div>
  <script>const vscode=acquireVsCodeApi();const goal=document.getElementById('projectGoal');const count=document.getElementById('goalCount');const start=document.getElementById('startProject');if(goal&&count&&start){goal.addEventListener('input',()=>{count.textContent=goal.value.length+' 字'});start.addEventListener('click',()=>{const value=goal.value.trim();if(!value){goal.focus();goal.style.borderColor='var(--danger)';return}start.disabled=true;start.textContent='正在理解需求…';const beginner=document.querySelector('input[name="projectMode"]:checked').value==='beginner';vscode.postMessage({type:'startProject',goal:value,beginnerMode:beginner})})}document.addEventListener('click',event=>{const target=event.target.closest('button');if(!target||target.disabled||target.id==='startProject')return;if(target.classList.contains('primary'))target.disabled=true;if(target.dataset.command)vscode.postMessage({type:'command',command:target.dataset.command});if(target.dataset.message==='record')vscode.postMessage({type:'record',index:Number(target.dataset.index)});if(target.dataset.message==='editGoal'||target.dataset.message==='editHardware')vscode.postMessage({type:target.dataset.message});if(target.dataset.message==='showError'){const detail=document.querySelector('.evidence.bad details');if(detail)detail.open=true;(detail||document.querySelector('.status.error'))?.scrollIntoView({behavior:'smooth',block:'center'})}});</script></body></html>`;
}
function projectAttributionMarkdown(spec, installedLibraries = []) {
    const config = plugin.workspace.getConfiguration('arduinoAgent');
    const packPath = config.get('hardwarePackPath', 'D:\\ArduinoAgentData\\hardware-packs\\fritzing-core');
    const sources = new Map();
    for (const component of spec.components) {
        for (const contract of (0, hardwareContracts_1.contractsFor)(`${component.name} ${component.model || ''}`)) {
            for (const evidence of contract.evidence) {
                sources.set(`reference:${evidence.url}`, { title: evidence.title, url: evidence.url, license: '仅引用链接；版权归原权利人', use: `${component.name} 的端子、接口或示例依据` });
            }
        }
        const image = (0, hardwareImages_1.localHardwareImage)(component.name, component.model || '', component.role, packPath);
        if (image)
            sources.set(`image:${image.sourceUrl}:${image.sourceLabel}`, { title: image.sourceLabel, url: image.sourceUrl, license: image.license || '未知，禁止随项目再分发', use: `${component.name} 的识别参考图` });
    }
    const rows = [...sources.values()].map(source => `| ${source.title.replace(/\|/g, '\\|')} | ${source.use.replace(/\|/g, '\\|')} | ${source.license.replace(/\|/g, '\\|')} | ${source.url} |`).join('\n');
    const libraries = [...new Set(spec.libraries)].map(name => {
        const metadata = installedLibraries?.find(item => item.name.toLowerCase() === name.toLowerCase());
        return `- ${name} ${metadata?.version || '未知版本'}：${metadata?.license || '许可证未知'}${metadata?.website ? `；上游：${metadata.website}` : ''}`;
    }).join('\n') || '- 本项目未声明第三方 Arduino 库。';
    return `# 第三方资料、图片与许可证说明\n\n本文件由 Arduino Agent 自动生成，用于保留来源和署名，不构成法律意见。没有明确许可证的素材不会被认定为可自由再分发。\n\n## 图片与硬件资料\n\n| 来源 | 用途 | 许可证/使用状态 | 原始链接 |\n|---|---|---|---|\n${rows || '| 无第三方素材 | - | - | - |'}\n\n## Arduino 代码库\n\n${libraries}\n\n代码库由用户本机的 Arduino CLI/Library Manager 单独下载，本项目不自动打包库源码。发布项目时应保留各库自身的 LICENSE 和版权声明。\n\n## 使用说明\n\n- Fritzing 图片仅用于元件识别和接线参考，显示时保留来源及许可证。\n- 官方数据手册、产品页和示例仅以链接方式引用，不复制正文或图片。\n- 淘宝搜索结果及卖家图片不下载、不缓存、不随项目发布。\n- “许可证未知”或“需要确认”的素材，在确认授权前不得放入开源发布包。\n`;
}
function evaluateProvenanceTerminals(spec, packPath) {
    const issues = [];
    const normalize = (value) => value.toUpperCase().replace(/[^A-Z0-9+\-]/g, '');
    const genericPins = new Set(['VCC', 'VIN', 'VDD', 'GND', 'GROUND', '+', '-', '5V', '3V3', '3.3V']);
    for (const component of spec.components) {
        if (component.role === 'controller' || component.role === 'power' || (0, componentClassification_1.isNonElectricalAccessory)(component))
            continue;
        const owned = spec.connections.filter(item => item.componentId.toLowerCase() === component.id.toLowerCase()).map(item => normalize(item.sourcePin));
        const incoming = spec.connections.filter(item => `${item.target}`.toLowerCase().includes(component.name.toLowerCase())).map(item => normalize(item.targetPin));
        const used = [...new Set([...owned, ...incoming])].filter(Boolean);
        const contract = (0, hardwareContracts_1.contractsFor)(`${component.name} ${component.model || ''}`)[0];
        if (contract) {
            const declared = [...contract.signalPins, ...contract.powerPins].flatMap(pin => pin.split(/\s+或\s+|[\/]/)).map(normalize).filter(pin => pin && !/可选|按所选接口/.test(pin));
            const allowed = new Set([...declared, ...genericPins]);
            for (const pin of used)
                if (/^[A-Z][A-Z0-9+\-]*$/.test(pin) && !allowed.has(pin) && !/^[AD]\d+$|^(?:HV|LV)\d+$/.test(pin))
                    issues.push(`${component.name} 使用了官方契约未声明的端子 ${pin}`);
            continue;
        }
        const pack = (0, hardwareImages_1.localHardwarePackMatch)(component.name, component.model || '', component.interface || '', packPath);
        if (!pack?.connectors.length)
            continue;
        const declared = new Set(pack.connectors.flatMap(connector => [connector.id, connector.name || '']).map(normalize).filter(Boolean));
        if (declared.size < 2)
            continue;
        for (const pin of used)
            if (/^[A-Z][A-Z0-9+\-]*$/.test(pin) && !declared.has(pin) && !genericPins.has(pin) && !/^[AD]\d+$/.test(pin))
                issues.push(`${component.name} 的端子 ${pin} 与匹配到的 Fritzing 器件 ${pack.title} 不一致，请核对具体模块型号`);
    }
    return [...new Set(issues)];
}
function communityReadme(state) {
    const spec = state.spec;
    const confidence = (0, workflow_1.verificationSummary)(state);
    const label = (value) => ({ passed: '通过', failed: '失败', 'not-run': '尚未验证', unavailable: '不可用' }[value] || value);
    return `# ${spec.goal}\n\n> 本项目由 Arduino Agent 辅助生成。编译或仿真通过不代表实物一定安全、正确或达到预期。\n\n## 开发板\n\n- ${spec.board.name}\n- FQBN：${spec.board.fqbn}\n\n## 可信度\n\n- 结构化接线：${label(confidence.wiring)}\n- 代码静态检查：${label(confidence.static)}\n- 目标板编译：${label(confidence.compile)}\n- 仿真：${label(confidence.simulation)}\n- 实物验证：${label(confidence.physical)}\n\n## 接线表\n\n${spec.connections.map(item => `- ${item.componentName} ${item.sourcePin} → ${item.target} ${item.targetPin}`).join('\n')}\n\n## 代码库\n\n${(state.installedLibraries || []).map(item => `- ${item.name} ${item.version} · ${item.license}${item.website ? ` · ${item.website}` : ''}`).join('\n') || '- 无第三方库记录'}\n\n## 安全说明\n\n发布包已排除 API Key、串口地址、本机路径、临时文件和 IDE 会话。高电流、高电压、运动机构及电池项目必须由具备相应知识的人复核。\n`;
}
function exportSafetyIssues(files) {
    const issues = [];
    for (const [name, bytes] of Object.entries(files)) {
        const content = Buffer.from(bytes).toString('utf8');
        if (/sk-[A-Za-z0-9_-]{16,}|(?:api[_-]?key|authorization)\s*[:=]\s*["'][^"']{8,}/i.test(content))
            issues.push(`${name} 可能包含 API Key`);
        if (/[A-Z]:\\(?:Users|用户|文档|Desktop|AppData)\\/i.test(content))
            issues.push(`${name} 包含本机绝对路径`);
        if (/COM\d+|\/dev\/tty(?:USB|ACM)\d+/i.test(content))
            issues.push(`${name} 包含串口地址`);
    }
    return [...new Set(issues)];
}
function start(context) {
    let lastScanAt = 0;
    let uploadInProgress = false;
    let dashboardPanel;
    let restoredProjectFile = '';
    const startWithNewProject = plugin.workspace.getConfiguration('arduinoAgent').get('startWithNewProject', true);
    const openDashboardOnStartup = plugin.workspace.getConfiguration('arduinoAgent').get('openDashboardOnStartup', true);
    let startupSuppressedFile = '';
    let startupInitialization = Promise.resolve();
    const workflow = () => context.workspaceState.get('workflowState') || (0, workflow_1.initialWorkflow)();
    const snapshotUri = (projectFile) => plugin.Uri.file((0, path_1.join)((0, path_1.dirname)(projectFile), '.arduino-agent-state.json'));
    const persistProjectSnapshot = async (state) => {
        const brief = context.workspaceState.get('projectBrief');
        const projectFile = state.projectFile || brief?.projectFile;
        if (!brief || !projectFile)
            return;
        const snapshot = { version: 1, projectFile, brief: { ...brief, projectFile }, workflow: { ...state, projectFile }, records: context.workspaceState.get('changeRecords', []), savedAt: new Date().toISOString() };
        try {
            await plugin.workspace.fs.writeFile(snapshotUri(projectFile), Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8'));
            if (state.spec)
                await plugin.workspace.fs.writeFile(plugin.Uri.file((0, path_1.join)((0, path_1.dirname)(projectFile), 'THIRD_PARTY_NOTICES.md')), Buffer.from(projectAttributionMarkdown(state.spec, state.installedLibraries), 'utf8'));
            const sessions = context.globalState.get('projectSessions', {});
            sessions[projectFile.toLowerCase()] = snapshot;
            await context.globalState.update('projectSessions', sessions);
        }
        catch {
            // 项目仍保存在 IDE 状态中；下次保存工作流时再次尝试写入旁车状态文件。
        }
    };
    const renderDashboard = () => {
        if (!dashboardPanel)
            return;
        const brief = context.workspaceState.get('projectBrief');
        const draftGoal = context.workspaceState.get('projectDraft', '') || context.workspaceState.get('lastBeginnerIdea', '') || context.workspaceState.get('lastProjectGoal', '') || brief?.goal || '';
        const draftBeginner = context.workspaceState.get('projectDraftBeginner', !brief);
        const showComposer = context.workspaceState.get('projectComposerVisible', workflow().phase === 'idle');
        dashboardPanel.webview.html = themedAgentHtml(workflowDashboardHtml(workflow(), brief, context.workspaceState.get('changeRecords', []), draftGoal, draftBeginner, showComposer));
    };
    const saveWorkflow = async (state) => {
        await context.workspaceState.update('workflowState', state);
        await persistProjectSnapshot(state);
        agentProvider?.refresh();
        renderDashboard();
    };
    const setWorkflow = async (patch) => saveWorkflow((0, workflow_1.updateWorkflow)(workflow(), patch));
    let agentProvider;
    class RecordDocumentProvider {
        constructor() {
            this.content = '# 修改记录\n\n请从左侧选择一条记录。';
            this.changed = new plugin.EventEmitter();
            this.onDidChange = this.changed.event;
            this.uri = plugin.Uri.parse('arduino-agent-record:/修改记录详情.md');
        }
        update(record) {
            this.content = `# 修改记录详情\n\n**修改时间：** ${record.time}\n\n**文件：** ${record.file}\n\n**原因：** ${record.reason}\n\n## 修改前\n\n\`\`\`cpp\n${record.before}\n\`\`\`\n\n## 修改后\n\n\`\`\`cpp\n${record.after}\n\`\`\``;
            this.changed.fire(this.uri);
        }
        provideTextDocumentContent() { return this.content; }
    }
    const recordDocument = new RecordDocumentProvider();
    context.subscriptions.push(plugin.workspace.registerTextDocumentContentProvider('arduino-agent-record', recordDocument));
    class AgentItem extends plugin.TreeItem {
        constructor(label, command, state = plugin.TreeItemCollapsibleState.None, children = [], description, tooltip) {
            super(label);
            this.children = children;
            this.command = command;
            this.collapsibleState = state;
            this.description = description;
            this.tooltip = tooltip || label;
        }
    }
    class AgentProvider {
        constructor() {
            this.changed = new plugin.EventEmitter();
            this.onDidChangeTreeData = this.changed.event;
        }
        refresh() { this.changed.fire(undefined); }
        getTreeItem(item) { return item; }
        getChildren(element) {
            if (element)
                return element.children;
            const records = context.workspaceState.get('changeRecords', []);
            const brief = context.workspaceState.get('projectBrief');
            const state = workflow();
            const action = (0, workflow_1.nextAction)(state);
            const history = records.map((r, i) => new AgentItem(`${r.time} · ${r.reason}`, { command: 'arduinoFirstRunAgent.showRecord', title: '查看修改记录', arguments: [i] }));
            const statusItem = new AgentItem(`项目状态：${(0, workflow_1.phaseLabel)(state.phase)}`, { command: 'arduinoFirstRunAgent.dashboard', title: '打开项目看板' }, plugin.TreeItemCollapsibleState.None, [], state.status === 'running' ? '正在处理…' : state.status === 'error' ? '需要处理' : state.status, state.message);
            statusItem.iconPath = new plugin.ThemeIcon(state.status === 'running' ? 'loading~spin' : state.status === 'error' ? 'error' : state.status === 'success' ? 'pass-filled' : 'circle-outline');
            const currentAction = action.command ? new AgentItem(`现在请做：${action.label}`, { command: action.command, title: action.label }, plugin.TreeItemCollapsibleState.None, [], '点击执行', `当前唯一推荐操作：${action.label}`) : undefined;
            if (currentAction)
                currentAction.iconPath = new plugin.ThemeIcon('arrow-right');
            const actionChildren = currentAction ? [currentAction] : [new AgentItem(state.message, undefined, plugin.TreeItemCollapsibleState.None, [], '请等待')];
            const actionGroup = new AgentItem('当前操作', undefined, plugin.TreeItemCollapsibleState.Expanded, actionChildren, '按顺序完成');
            actionGroup.iconPath = new plugin.ThemeIcon('target');
            const toolChildren = brief ? [
                new AgentItem('重新生成项目方案', { command: 'arduinoFirstRunAgent.createProject', title: '重新生成项目方案' }, plugin.TreeItemCollapsibleState.None, [], '已有方案', `完整项目需求：\n${brief.goal}\n\n传感器：${brief.sensor}\n输出：${brief.output}\n传感器引脚：${brief.sensorPin}\n输出引脚：${brief.outputPin}`),
                new AgentItem('接线图：查看完整接线', { command: 'arduinoFirstRunAgent.showWiring', title: '查看接线图' }, plugin.TreeItemCollapsibleState.None, [], `${brief.wiring?.length || 0} 项连接`),
                ...(['wiring', 'device', 'upload-ready', 'uploading', 'observing', 'revising', 'completed'].includes(state.phase)
                    ? [new AgentItem(brief.wiringConfirmed ? '接线确认：已确认' : '接线确认：等待用户', { command: 'arduinoFirstRunAgent.confirmWiring', title: '核对接线' })] : []),
                ...(brief.projectFile ? [new AgentItem('编译检查：当前项目', { command: 'arduinoFirstRunAgent.compile', title: '编译当前项目' })] : []),
                ...(brief.wiringConfirmed ? [new AgentItem('上传检查：写入开发板', { command: 'arduinoFirstRunAgent.upload', title: '上传并检查' })] : []),
                ...(['observing', 'revising', 'completed'].includes(state.phase) ? [new AgentItem('行为确认：实物反馈', { command: 'arduinoFirstRunAgent.behavior', title: '确认实物反馈' })] : [])
            ] : [new AgentItem('生成方案后显示相关工具', undefined, plugin.TreeItemCollapsibleState.None, [], '当前无需操作')];
            const toolsGroup = new AgentItem('其他工具', undefined, plugin.TreeItemCollapsibleState.Expanded, toolChildren);
            toolsGroup.iconPath = new plugin.ThemeIcon('tools');
            const historyChildren = [...history, ...(records.length ? [new AgentItem('删除修改记录…', { command: 'arduinoFirstRunAgent.deleteRecord', title: '删除修改记录' })] : [])];
            return [
                statusItem,
                actionGroup,
                toolsGroup,
                new AgentItem(`修改记录（${records.length}）`, undefined, plugin.TreeItemCollapsibleState.Expanded, historyChildren)
            ];
        }
    }
    agentProvider = new AgentProvider();
    // The legacy tree view was removed: the project dashboard is now the single
    // user-facing Agent surface and opens automatically with Arduino IDE.
    if (startWithNewProject) {
        const startupFile = plugin.window.activeTextEditor?.document.uri.fsPath;
        if (startupFile?.toLowerCase().endsWith('.ino'))
            startupSuppressedFile = startupFile.toLowerCase();
        startupInitialization = (async () => {
            // Arduino IDE restores editors and retained webviews asynchronously. Wait until that
            // restoration finishes, then make the new-project state authoritative for this launch.
            await new Promise(resolve => setTimeout(resolve, 1200));
            await context.workspaceState.update('projectBrief', undefined);
            await context.workspaceState.update('workflowState', (0, workflow_1.initialWorkflow)());
            await context.workspaceState.update('projectComposerVisible', true);
            await context.workspaceState.update('projectDraft', '');
            await context.workspaceState.update('lastBeginnerIdea', '');
            await context.workspaceState.update('lastProjectGoal', '');
        })();
        void startupInitialization.then(async () => {
            agentProvider.refresh();
            const restoredEditorFile = plugin.window.activeTextEditor?.document.uri.fsPath || startupFile || '';
            const isRestoredIno = restoredEditorFile.toLowerCase().endsWith('.ino');
            const isAlreadyFreshSketch = /[\\/](?:\.arduinoide-unsaved|arduinoide-unsaved)[^\\/]*[\\/]/i.test(restoredEditorFile);
            if (isRestoredIno && !isAlreadyFreshSketch) {
                try {
                    // Replace one restored, saved sketch with one Arduino-native temporary
                    // sketch. A temporary sketch must never create another temporary sketch.
                    await plugin.commands.executeCommand('arduino-new-sketch');
                }
                catch (error) {
                    console.warn('Arduino Agent could not replace the restored sketch at startup.', error);
                }
            }
            if (openDashboardOnStartup)
                await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
        });
    }
    else if (openDashboardOnStartup) {
        setTimeout(() => { void plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard'); }, 1200);
    }
    const restoreProjectSession = async (file) => {
        await startupInitialization;
        if (!file || !file.toLowerCase().endsWith('.ino'))
            return;
        const normalizedFile = file.toLowerCase();
        if (restoredProjectFile === normalizedFile)
            return;
        if (startupSuppressedFile === normalizedFile)
            return;
        if (startupSuppressedFile && startupSuppressedFile !== normalizedFile)
            startupSuppressedFile = '';
        if (startWithNewProject && !startupSuppressedFile) {
            startupSuppressedFile = normalizedFile;
            restoredProjectFile = '';
            return;
        }
        let snapshot;
        try {
            const raw = await plugin.workspace.fs.readFile(snapshotUri(file));
            snapshot = JSON.parse(Buffer.from(raw).toString('utf8'));
        }
        catch {
            snapshot = context.globalState.get('projectSessions', {})[normalizedFile];
        }
        if (!snapshot || snapshot.version !== 1 || !snapshot.brief?.goal || !snapshot.workflow?.phase)
            return;
        snapshot.projectFile = file;
        snapshot.brief.projectFile = file;
        snapshot.workflow.projectFile = file;
        await context.workspaceState.update('projectBrief', snapshot.brief);
        await context.workspaceState.update('workflowState', snapshot.workflow);
        await context.workspaceState.update('changeRecords', Array.isArray(snapshot.records) ? snapshot.records : []);
        restoredProjectFile = normalizedFile;
        agentProvider.refresh();
        renderDashboard();
        plugin.window.showInformationMessage(`已恢复 ${(0, path_1.basename)(file)} 上次的 Agent 项目进度。`);
    };
    context.subscriptions.push(plugin.window.onDidChangeActiveTextEditor(editor => { void restoreProjectSession(editor?.document.uri.fsPath); }));
    context.subscriptions.push(plugin.workspace.onDidOpenTextDocument(document => { void restoreProjectSession(document.uri.fsPath); }));
    void restoreProjectSession(plugin.window.activeTextEditor?.document.uri.fsPath);
    const persistedWorkflow = workflow();
    if (!startWithNewProject && /(?:代码没有落实需求中的数量或参数|声音强度直接使用单次模拟值)/.test(persistedWorkflow.error || '')) {
        void context.workspaceState.update('workflowState', (0, workflow_1.updateWorkflow)(persistedWorkflow, {
            phase: 'idle', status: 'needs-user', message: '旧版生成失败状态已迁移，新版会验证代码差异并使用确定性行为修复。', error: undefined
        })).then(() => agentProvider.refresh());
    }
    else if (!startWithNewProject && /(?:代码经过自动修复后仍未通过生成门禁|硬件方案连续两次未通过检查)/.test(persistedWorkflow.error || '')) {
        void context.workspaceState.update('workflowState', (0, workflow_1.updateWorkflow)(persistedWorkflow, {
            phase: 'idle', status: 'needs-user', message: '旧版静态检查误判已修复，请重新生成该项目。', error: undefined
        })).then(() => agentProvider.refresh());
    }
    else if (!startWithNewProject && persistedWorkflow.status === 'running') {
        void context.workspaceState.update('workflowState', (0, workflow_1.updateWorkflow)(persistedWorkflow, {
            phase: 'blocked', status: 'error', message: '上次操作因 IDE 关闭或插件重载而中断，可以安全恢复。', error: '未收到上次工具操作的完成结果，请重新执行当前步骤。'
        })).then(() => agentProvider.refresh());
    }
    if (!startWithNewProject && /无法连接本地 AI 服务/.test(persistedWorkflow.error || '')) {
        const configuredBaseUrl = plugin.workspace.getConfiguration('arduinoAgent').get('baseUrl', 'http://localhost:11434/v1');
        const probeEndpoint = aiEndpoint(configuredBaseUrl);
        void startOllamaAndWait(probeEndpoint).then(async () => {
            const current = workflow();
            if (!/无法连接本地 AI 服务/.test(current.error || ''))
                return;
            await saveWorkflow((0, workflow_1.updateWorkflow)(current, {
                phase: 'idle',
                status: 'needs-user',
                message: '本地 14B AI 服务已恢复，可以重新生成项目方案。',
                error: undefined
            }));
        }).catch(() => {
            // 保留原错误；用户点击重试时还会再次自动启动并给出具体原因。
        });
    }
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.toggleDashboard', async () => {
        if (dashboardPanel) {
            dashboardPanel.dispose();
            return;
        }
        await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.dashboard', () => {
        if (dashboardPanel) {
            renderDashboard();
            dashboardPanel.reveal(plugin.ViewColumn.Two, false);
            return;
        }
        dashboardPanel = plugin.window.createWebviewPanel('arduinoAgentDashboard', 'Arduino Agent 项目看板', plugin.ViewColumn.Two, { enableScripts: true, retainContextWhenHidden: true });
        renderDashboard();
        dashboardPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'command' && typeof message.command === 'string' && message.command.startsWith('arduinoFirstRunAgent.'))
                await plugin.commands.executeCommand(message.command);
            if (message.type === 'record' && Number.isInteger(message.index))
                await plugin.commands.executeCommand('arduinoFirstRunAgent.showRecord', message.index);
            if (message.type === 'editGoal') {
                const savedGoal = context.workspaceState.get('lastBeginnerIdea', '') || context.workspaceState.get('lastProjectGoal', '') || context.workspaceState.get('projectBrief')?.goal || '';
                void plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', { goal: savedGoal, beginnerMode: context.workspaceState.get('projectDraftBeginner', false), showEditor: true });
            }
            if (message.type === 'editHardware') {
                const savedGoal = context.workspaceState.get('lastBeginnerIdea', '') || context.workspaceState.get('lastProjectGoal', '') || context.workspaceState.get('projectBrief')?.goal || '';
                void plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', { goal: savedGoal, beginnerMode: true, skipBeginnerWizard: false });
            }
            if (message.type === 'confirmWiring')
                await plugin.commands.executeCommand('arduinoFirstRunAgent.confirmWiring', 'diagram-confirmed');
            if (message.type === 'backDashboard')
                renderDashboard();
            if (message.type === 'behaviorFeedback' && typeof message.symptom === 'string')
                await plugin.commands.executeCommand('arduinoFirstRunAgent.behavior', { symptom: message.symptom, detail: typeof message.detail === 'string' ? message.detail : '', confirmedIds: Array.isArray(message.confirmedIds) ? message.confirmedIds.filter((id) => typeof id === 'string') : [] });
            if (message.type === 'behaviorAction' && typeof message.action === 'string')
                await plugin.commands.executeCommand('arduinoFirstRunAgent.behavior', { symptom: message.symptom, detail: message.detail, action: message.action });
            if (message.type === 'openExternal' && typeof message.url === 'string' && /^https:\/\//i.test(message.url))
                await plugin.env.openExternal(plugin.Uri.parse(message.url));
            if (message.type === 'saveStartupSettings') {
                const configuration = plugin.workspace.getConfiguration('arduinoAgent');
                await configuration.update('startWithNewProject', message.startWithNewProject === true, plugin.ConfigurationTarget.Global);
                await configuration.update('openDashboardOnStartup', message.openDashboardOnStartup === true, plugin.ConfigurationTarget.Global);
                plugin.window.showInformationMessage('Arduino Agent 启动设置已保存，将从下次打开 Arduino IDE 起生效。');
                renderDashboard();
            }
            if (message.type === 'saveAiSettings') {
                const provider = String(message.provider || '');
                const baseUrl = String(message.baseUrl || '').trim().replace(/\/$/, '');
                const apiMode = String(message.apiMode || 'chat-completions');
                const model = String(message.model || '').trim();
                const enteredKey = String(message.apiKey || '').trim();
                const existingKey = await context.secrets.get('arduinoAgent.apiKey') || '';
                const key = provider === 'ollama' ? 'ollama' : enteredKey || existingKey;
                if (!['ollama', 'openai', 'compatible'].includes(provider) || !baseUrl || !model || (!key && provider !== 'ollama')) {
                    await setWorkflow({ status: 'error', message: 'AI 设置不完整，请检查服务、地址、模型名称和 API Key。' });
                    await plugin.commands.executeCommand('arduinoFirstRunAgent.openSettings');
                }
                else {
                    try {
                        await testAiService(baseUrl, apiMode, key, model);
                        const configuration = plugin.workspace.getConfiguration('arduinoAgent');
                        await configuration.update('provider', provider, plugin.ConfigurationTarget.Global);
                        await configuration.update('baseUrl', baseUrl, plugin.ConfigurationTarget.Global);
                        await configuration.update('apiMode', apiMode, plugin.ConfigurationTarget.Global);
                        await configuration.update('codeModel', model, plugin.ConfigurationTarget.Global);
                        await configuration.update('model', model, plugin.ConfigurationTarget.Global);
                        if (provider === 'ollama')
                            await context.secrets.delete('arduinoAgent.apiKey');
                        else if (enteredKey)
                            await context.secrets.store('arduinoAgent.apiKey', enteredKey);
                        await setWorkflow({ status: workflow().phase === 'completed' ? 'success' : 'needs-user', message: `AI 服务测试通过并已保存：${provider === 'ollama' ? '本地 Ollama' : provider === 'openai' ? 'OpenAI 云端' : '其他兼容服务'} · ${model}`, error: undefined });
                    }
                    catch (error) {
                        await setWorkflow({ status: 'error', message: 'AI 设置未保存：模型测试失败。', error: error instanceof Error ? error.message : String(error) });
                    }
                }
            }
            if (message.type === 'startProject' && typeof message.goal === 'string' && message.goal.trim()) {
                const goal = message.goal.trim();
                const beginnerMode = message.beginnerMode === true;
                await context.workspaceState.update('projectDraft', goal);
                await context.workspaceState.update('projectDraftBeginner', beginnerMode);
                await context.workspaceState.update('projectComposerVisible', false);
                void plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', { goal, beginnerMode, skipBeginnerWizard: false });
            }
        }, null, context.subscriptions);
        dashboardPanel.onDidDispose(() => {
            dashboardPanel = undefined;
        }, null, context.subscriptions);
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.simulate', async () => {
        const current = workflow();
        const configured = plugin.workspace.getConfiguration('arduinoAgent').get('simulidePath', '').trim();
        if (!current.projectFile || !current.spec) {
            plugin.window.showWarningMessage('请先生成并保存项目。');
            return;
        }
        if (!configured || !(0, fs_1.existsSync)(configured)) {
            await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(current, { simulation: { status: 'unavailable', engine: 'SimulIDE', summary: '未配置 SimulIDE；编译结果不能替代仿真或实物验证' } }), { tool: 'simulator', ok: false, summary: '仿真当前不可用', detail: '在设置中填写 arduinoAgent.simulidePath 后可启动可选仿真。' }));
            plugin.window.showWarningMessage('未配置 SimulIDE。可信度保持“仿真不可用”，不会伪造通过结果。');
            return;
        }
        const child = (0, child_process_1.spawn)(configured, [], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(current, { simulation: { status: 'not-run', engine: 'SimulIDE', summary: '已启动 SimulIDE，等待用户建立电路并运行；尚未取得自动化结果' } }), { tool: 'simulator', ok: false, summary: '已启动仿真器，尚未验证', detail: 'SimulIDE 未提供当前项目的自动化电路模型，不能自动标记通过。' }));
        plugin.window.showInformationMessage('SimulIDE 已启动。只有实际建立电路并运行后才能记录仿真结果。');
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.exportCommunity', async () => {
        const current = workflow();
        if (!current.projectFile || !current.spec || !(0, fs_1.existsSync)(current.projectFile)) {
            plugin.window.showWarningMessage('请先生成并保存项目。');
            return;
        }
        const code = Buffer.from(await plugin.workspace.fs.readFile(plugin.Uri.file(current.projectFile))).toString('utf8');
        const safeSpec = { ...current.spec, board: { ...current.spec.board, confirmed: false }, connections: current.spec.connections.map(item => ({ ...item, confirmed: false })) };
        const libraryDetails = await installedLibraryDetails(current.spec.libraries);
        const environment = await reproducibleEnvironment(current.spec, libraryDetails);
        const files = {
            [`${(0, path_1.basename)(current.projectFile)}`]: (0, fflate_1.strToU8)(code),
            'README.md': (0, fflate_1.strToU8)(communityReadme(current)),
            'project-spec.json': (0, fflate_1.strToU8)(JSON.stringify(safeSpec, null, 2)),
            'build-environment.json': (0, fflate_1.strToU8)(JSON.stringify(environment, null, 2)),
            'THIRD_PARTY_NOTICES.md': (0, fflate_1.strToU8)(projectAttributionMarkdown(current.spec, libraryDetails))
        };
        for (const library of libraryDetails)
            if (library.licenseText)
                files[`THIRD_PARTY_LICENSES/${library.name.replace(/[^a-z0-9._-]+/gi, '_')}.txt`] = (0, fflate_1.strToU8)(library.licenseText);
        const issues = exportSafetyIssues(files);
        if (issues.length) {
            plugin.window.showErrorMessage(`分享包隐私检查未通过：${issues.join('；')}`);
            return;
        }
        const destination = await plugin.window.showSaveDialog({ defaultUri: plugin.Uri.file((0, path_1.join)((0, path_1.dirname)(current.projectFile), `${(0, path_1.basename)(current.projectFile, (0, path_1.extname)(current.projectFile))}-community.zip`)), filters: { 'ZIP archive': ['zip'] }, saveLabel: '导出社区分享包' });
        if (!destination)
            return;
        await plugin.workspace.fs.writeFile(destination, Buffer.from((0, fflate_1.zipSync)(files, { level: 6 })));
        plugin.window.showInformationMessage(`社区分享包已导出：${destination.fsPath}`);
    }));
    const chooseUploadTargetInDashboard = async (targets, recommendedFqbn) => new Promise(resolve => {
        if (!dashboardPanel) {
            resolve(undefined);
            return;
        }
        const ports = targets.map((item, index) => `<label class="option"><input type="radio" name="port" value="${index}" ${index === 0 ? 'checked' : ''}><span><b>${escapeHtml(item.address)}</b><small>${escapeHtml(item.boardName || 'USB 串口，板型需核对')}</small></span></label>`).join('');
        const boards = uploadBoards.map(item => `<label class="option"><input type="radio" name="board" value="${escapeHtml(item.fqbn)}" ${item.fqbn === recommendedFqbn ? 'checked' : ''}><span><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.fqbn === recommendedFqbn ? '当前方案建议' : item.description || item.fqbn)}</small></span></label>`).join('');
        dashboardPanel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:22px;background:#f5f7fb;color:#203047;font-family:Arial,"Microsoft YaHei",sans-serif}main{max-width:900px;margin:auto}header,.card{background:#fff;border:1px solid #dce4ee;border-radius:14px;padding:20px;margin-bottom:12px}h1{font-size:22px;margin:0 0 7px}h2{font-size:16px;margin:0 0 10px}p,small{color:#66758a;line-height:1.6}.options{display:grid;grid-template-columns:1fr;gap:8px}.option{display:flex;gap:10px;border:2px solid #dce4ee;border-radius:10px;padding:12px;cursor:pointer}.option:has(input:checked){border-color:#168c83;background:#eef9f7}.option b,.option small{display:block}.actions{display:flex;justify-content:flex-end;gap:10px;position:sticky;bottom:0;padding:14px 0;background:#f5f7fb}button{border:0;border-radius:8px;padding:11px 16px;font-weight:700;cursor:pointer}.back{background:#e8eef5;color:#294158}.upload{background:#168c83;color:#fff}</style></head><body><main><header><h1>确认上传目标</h1><p>请按实物核对串口和开发板。CH340 只能说明串口芯片，不能自动判断 Uno 或 Nano。</p></header><section class="card"><h2>USB 串口</h2><div class="options">${ports}</div></section><section class="card"><h2>实际开发板</h2><div class="options">${boards}</div></section><div class="actions"><button id="back" class="back">返回项目看板</button><button id="upload" class="upload">确认并上传</button></div></main><script>const vscode=acquireVsCodeApi();document.getElementById('back').onclick=()=>vscode.postMessage({type:'uploadDecision',cancel:true});document.getElementById('upload').onclick=()=>vscode.postMessage({type:'uploadDecision',port:Number(document.querySelector('input[name="port"]:checked').value),fqbn:document.querySelector('input[name="board"]:checked').value});</script></body></html>`;
        dashboardPanel.webview.html = themedAgentHtml(dashboardPanel.webview.html);
        let settled = false;
        let messageDisposable;
        let disposeDisposable;
        const finish = (value) => { if (settled)
            return; settled = true; messageDisposable?.dispose(); disposeDisposable?.dispose(); resolve(value); if (!value)
            renderDashboard(); };
        messageDisposable = dashboardPanel.webview.onDidReceiveMessage(message => {
            if (message.type !== 'uploadDecision')
                return;
            if (message.cancel === true) {
                finish();
                return;
            }
            const target = targets[Number(message.port)];
            const fqbn = String(message.fqbn || '');
            if (target && fqbn)
                finish({ target, fqbn });
        });
        disposeDisposable = dashboardPanel.onDidDispose(() => { if (!settled) {
            settled = true;
            messageDisposable?.dispose();
            resolve(undefined);
        } });
    });
    const uploadCurrentSketch = async () => {
        if (uploadInProgress)
            return { code: 1, stdout: '', stderr: '上传正在进行，请勿重复点击。' };
        const savedBrief = context.workspaceState.get('projectBrief');
        const preferredFile = savedBrief?.projectFile && (0, fs_1.existsSync)(savedBrief.projectFile) ? savedBrief.projectFile : currentSketch()?.file;
        if (!preferredFile)
            return { code: 1, stdout: '', stderr: '未打开 Arduino .ino 工程，无法上传。' };
        const layout = await ensureSketchLayout(preferredFile);
        if (layout.migrated && savedBrief) {
            savedBrief.projectFile = layout.file;
            await context.workspaceState.update('projectBrief', savedBrief);
            await setWorkflow({ projectFile: layout.file, message: '已自动修正 Arduino 工程目录，准备上传。' });
        }
        const sketch = { file: layout.file, folder: (0, path_1.dirname)(layout.file) };
        if (!sketch)
            return { code: 1, stdout: '', stderr: '未打开 Arduino .ino 工程，无法上传。' };
        const listed = await runCli(['board', 'list', '--format', 'json']);
        if (listed.code !== 0)
            return listed;
        const targets = uploadTargets(listed.stdout);
        if (!targets.length)
            return { code: 1, stdout: '', stderr: '未检测到可用的 USB 串口，请检查数据线和驱动。' };
        const confirmedSpecBoard = workflow().spec?.board.confirmed ? workflow().spec?.board.fqbn : undefined;
        if (!dashboardPanel)
            await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
        const decision = await chooseUploadTargetInDashboard(targets, context.workspaceState.get('uploadFqbn') || confirmedSpecBoard || workflow().spec?.board.fqbn || 'arduino:avr:uno');
        if (!decision)
            return { code: 1, stdout: '', stderr: '用户取消了上传。' };
        const { target, fqbn } = decision;
        await context.workspaceState.update('uploadFqbn', fqbn);
        uploadInProgress = true;
        await setWorkflow({ phase: 'uploading', status: 'running', message: `正在上传到 ${target.address}（${fqbn}），按钮已锁定。`, error: undefined });
        plugin.window.showInformationMessage(`正在上传到 ${target.address}（${fqbn}）…`);
        try {
            const latest = await runCli(['board', 'list', '--format', 'json']);
            const stillConnected = latest.code === 0 && uploadTargets(latest.stdout).some(item => item.address === target.address);
            if (!stillConnected) {
                const disconnected = { code: 1, stdout: '', stderr: `${target.address} 在确认后已断开或端口号发生变化，请重新扫描。` };
                await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'device', status: 'error', message: '上传前设备发生变化，请重新扫描。', error: disconnected.stderr }), { tool: 'uploader', ok: false, summary: '上传前端口失效', detail: disconnected.stderr }));
                return disconnected;
            }
            const result = await runCli(['upload', '--port', target.address, '--fqbn', fqbn, sketch.folder], sketch.folder, 120000);
            const friendlyError = result.code === 0 ? undefined : compactUploadError(result, target.address, fqbn);
            const nextState = workflow();
            if (result.code === 0)
                nextState.spec?.acceptance.filter(item => item.evidence === 'upload').forEach(item => { item.passed = true; });
            await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(nextState, { phase: result.code === 0 ? 'observing' : 'blocked', status: result.code === 0 ? 'needs-user' : 'error', message: result.code === 0 ? '程序已上传，请观察实物效果。' : '上传失败，Agent 已定位到设备或板型问题。', error: friendlyError }), { tool: 'uploader', ok: result.code === 0, summary: result.code === 0 ? `已上传到 ${target.address}` : '上传失败', detail: friendlyError || '' }));
            return result;
        }
        finally {
            uploadInProgress = false;
        }
    };
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.openStartupSettings', async () => {
        const configuration = plugin.workspace.getConfiguration('arduinoAgent');
        if (!dashboardPanel)
            await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
        if (!dashboardPanel)
            return;
        dashboardPanel.webview.html = themedAgentHtml(startupSettingsHtml(configuration.get('startWithNewProject', true), configuration.get('openDashboardOnStartup', true)));
        dashboardPanel.reveal(plugin.ViewColumn.Two, false);
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.openSettings', async () => {
        const configuration = plugin.workspace.getConfiguration('arduinoAgent');
        const configuredKey = await context.secrets.get('arduinoAgent.apiKey') || configuration.get('apiKey', '') || process.env.OPENAI_API_KEY || '';
        if (!dashboardPanel)
            await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
        if (dashboardPanel) {
            dashboardPanel.webview.html = themedAgentHtml(aiSettingsHtml(configuration.get('provider', 'ollama'), configuration.get('baseUrl', 'http://localhost:11434/v1'), configuration.get('apiMode', 'chat-completions'), resolveModelRoles(configuration).code, Boolean(configuredKey)));
            return;
        }
        const currentProvider = configuration.get('provider', 'ollama');
        const currentBaseUrl = configuration.get('baseUrl', 'http://localhost:11434/v1');
        const currentApiMode = configuration.get('apiMode', 'chat-completions');
        const currentModels = resolveModelRoles(configuration);
        const currentModel = currentModels.code;
        const providerName = currentProvider === 'ollama' ? '本地 Ollama' : currentProvider === 'openai' ? 'OpenAI 云端' : '其他 AI 服务';
        const picked = await plugin.window.showQuickPick([
            { label: '$(info) 查看当前 AI 配置（不修改）', description: `${providerName} · ${currentModel}`, provider: 'view', baseUrl: currentBaseUrl, apiMode: currentApiMode },
            { label: 'OpenAI 云端', description: '需单独申请 API Key，速度快，API 通常按使用量计费', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiMode: 'responses' },
            { label: '本地 Ollama', description: '无需 API Key，可离线运行；速度取决于电脑性能', provider: 'ollama', baseUrl: 'http://localhost:11434/v1', apiMode: 'chat-completions' },
            { label: '其他 AI 服务', description: '已有 Kimi、DeepSeek 或第三方 API 账号时选择', provider: 'compatible', baseUrl: configuration.get('baseUrl', ''), apiMode: 'chat-completions' }
        ], { placeHolder: '查看当前配置，或选择要重新配置的 AI 服务' });
        if (!picked)
            return;
        if (picked.provider === 'view') {
            const storedKey = await context.secrets.get('arduinoAgent.apiKey');
            const legacyKey = configuration.get('apiKey', '');
            const keyState = currentProvider === 'ollama' ? '本地服务不需要' : (storedKey || legacyKey || process.env.OPENAI_API_KEY) ? '已安全保存（不显示明文）' : '未配置';
            const action = await plugin.window.showInformationMessage(`当前 Arduino Agent AI 配置\n\n服务：${providerName}\n规划模型：${currentModels.planning}\n代码模型：${currentModels.code}\n审查模型：${currentModels.review}\nAPI 地址：${currentBaseUrl}\n接口协议：${currentApiMode === 'responses' ? 'Responses API' : 'Chat Completions'}\nAPI Key：${keyState}`, { modal: true }, '测试当前 AI');
            if (action === '测试当前 AI')
                await plugin.commands.executeCommand('arduinoFirstRunAgent.testAi');
            return;
        }
        const guides = {
            openai: {
                text: '适合：希望生成速度快、电脑配置较低的用户。\n\n需要准备：OpenAI API Key 和可用的 API 模型。ChatGPT 网页版账号或会员不等于 API 额度，API 需要在开发者平台单独开通。',
                url: 'https://platform.openai.com/api-keys'
            },
            ollama: {
                text: '适合：希望免费、本地运行、不把需求发送到云端的用户。\n\n需要准备：安装 Ollama 并下载代码模型。无需 API Key，但会占用磁盘和内存，生成速度取决于电脑性能。',
                url: 'https://ollama.com/download'
            },
            compatible: {
                text: '适合：已经拥有 Kimi、DeepSeek、第三方网关或自建模型 API 的用户。\n\n需要准备：平台提供的 API 基础地址、准确模型 ID、API Key 和接口协议。网页版免费聊天通常不能直接当 API 使用。'
            }
        };
        const guide = guides[picked.provider];
        const guideActions = guide.url ? ['继续配置', '打开官方指引'] : ['继续配置', '查看服务商指引'];
        const guideDecision = await plugin.window.showInformationMessage(`${picked.label}\n\n${guide.text}`, { modal: true }, ...guideActions);
        if (guideDecision === '打开官方指引' && guide.url) {
            await plugin.env.openExternal(plugin.Uri.parse(guide.url));
            return;
        }
        if (guideDecision === '查看服务商指引') {
            const serviceGuide = await plugin.window.showQuickPick([
                { label: 'Kimi / Moonshot 官方开放平台', description: '查看 API 文档与模型名称', url: 'https://platform.moonshot.cn/docs' },
                { label: 'DeepSeek 官方 API 文档', description: '查看 API 地址、Key 与模型名称', url: 'https://api-docs.deepseek.com/' },
                { label: '我使用其他服务', description: '请在该服务官网查找“API 文档”或“开发者平台”', url: '' }
            ], { placeHolder: '选择你使用的 AI 服务' });
            if (serviceGuide?.url)
                await plugin.env.openExternal(plugin.Uri.parse(serviceGuide.url));
            return;
        }
        if (guideDecision !== '继续配置')
            return;
        let baseUrl = picked.baseUrl;
        let apiMode = picked.apiMode;
        if (picked.provider === 'compatible') {
            baseUrl = (await plugin.window.showInputBox({ title: 'AI 服务 API 地址', prompt: '填写该 AI 平台文档提供的 v1 基础地址', value: baseUrl, placeHolder: 'https://example.com/v1', ignoreFocusOut: true }))?.trim() || '';
            if (!baseUrl)
                return;
            const mode = await plugin.window.showQuickPick([{ label: 'Chat Completions', value: 'chat-completions' }, { label: 'Responses API', value: 'responses' }], { placeHolder: '选择服务支持的 API 协议' });
            if (!mode)
                return;
            apiMode = mode.value;
        }
        const oldModel = configuration.get('codeModel', '');
        const model = (await plugin.window.showInputBox({ title: '模型名称', prompt: picked.provider === 'openai' ? '填写你的 OpenAI 项目实际可用的模型 ID' : '填写服务中已经存在的模型名称', value: picked.provider === 'ollama' ? (oldModel || 'qwen2.5-coder:14b') : (/qwen/i.test(oldModel) ? '' : oldModel), placeHolder: picked.provider === 'openai' ? '从 OpenAI 控制台复制模型 ID' : '模型 ID', ignoreFocusOut: true }))?.trim() || '';
        if (!model)
            return;
        let key = '';
        if (picked.provider !== 'ollama') {
            key = (await plugin.window.showInputBox({ title: 'API Key（最后一步）', prompt: '填写后将立即测试连接；测试成功才会切换服务', password: true, ignoreFocusOut: true }))?.trim() || '';
            if (!key) {
                plugin.window.showWarningMessage('AI 服务尚未切换：API Key 步骤被取消。');
                return;
            }
            try {
                await testAiService(baseUrl, apiMode, key, model);
            }
            catch (error) {
                plugin.window.showErrorMessage(`AI 模型运行测试失败，设置未切换：${error instanceof Error ? error.message : String(error)}`);
                return;
            }
        }
        await configuration.update('provider', picked.provider, plugin.ConfigurationTarget.Global);
        await configuration.update('baseUrl', baseUrl.replace(/\/$/, ''), plugin.ConfigurationTarget.Global);
        await configuration.update('apiMode', apiMode, plugin.ConfigurationTarget.Global);
        await configuration.update('codeModel', model, plugin.ConfigurationTarget.Global);
        await configuration.update('model', model, plugin.ConfigurationTarget.Global);
        if (picked.provider !== 'ollama')
            await context.secrets.store('arduinoAgent.apiKey', key);
        else
            await context.secrets.delete('arduinoAgent.apiKey');
        if (picked.provider === 'ollama') {
            try {
                await startOllamaAndWait(aiEndpoint(baseUrl));
                plugin.window.showInformationMessage(`AI 服务已保存：本地 Ollama · ${model}`);
            }
            catch (error) {
                plugin.window.showWarningMessage(`设置已保存，但 Ollama 暂未就绪：${error instanceof Error ? error.message : String(error)}`);
            }
        }
        else {
            plugin.window.showInformationMessage(`连接测试成功，AI 服务已切换：${picked.label} · ${model}`);
        }
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.testAi', async () => {
        const configuration = plugin.workspace.getConfiguration('arduinoAgent');
        const provider = configuration.get('provider', 'ollama');
        const baseUrl = configuration.get('baseUrl', 'http://localhost:11434/v1');
        const apiMode = configuration.get('apiMode', 'chat-completions');
        const roles = resolveModelRoles(configuration);
        const model = roles.code;
        const local = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(baseUrl);
        const apiKey = await context.secrets.get('arduinoAgent.apiKey') || configuration.get('apiKey') || process.env.OPENAI_API_KEY || (local ? 'ollama' : '');
        if (!model || (!apiKey && provider !== 'ollama')) {
            plugin.window.showWarningMessage('AI 服务配置不完整，请先打开 AI 设置。');
            return;
        }
        await plugin.window.withProgress({ location: plugin.ProgressLocation.Notification, title: `正在测试 ${model}`, cancellable: false }, async () => {
            try {
                const uniqueModels = [...new Set([roles.planning, roles.code, roles.review])];
                const replies = [];
                for (const targetModel of uniqueModels)
                    replies.push(`${targetModel}：“${await testAiService(baseUrl, apiMode, apiKey || 'ollama', targetModel)}”`);
                plugin.window.showInformationMessage(`AI 测试成功：${provider} · ${replies.join('；')}`);
            }
            catch (error) {
                plugin.window.showErrorMessage(`AI 测试失败：${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.retry', async () => {
        const state = workflow();
        const brief = context.workspaceState.get('projectBrief');
        const lastTool = state.evidence[0]?.tool;
        if (/修改|反馈/.test(state.message) && brief?.projectFile) {
            await plugin.commands.executeCommand('arduinoFirstRunAgent.behavior');
            return;
        }
        if (!brief?.projectFile || lastTool === 'generator') {
            const savedGoal = context.workspaceState.get('lastProjectGoal', '') || brief?.goal || state.spec?.goal || '';
            await plugin.commands.executeCommand('arduinoFirstRunAgent.createProject', savedGoal);
            return;
        }
        if (lastTool === 'device-scan') {
            await plugin.commands.executeCommand('arduinoFirstRunAgent.scan');
            return;
        }
        if (lastTool === 'uploader') {
            await plugin.commands.executeCommand('arduinoFirstRunAgent.upload');
            return;
        }
        if (lastTool === 'user' && state.phase === 'blocked') {
            await plugin.commands.executeCommand('arduinoFirstRunAgent.behavior');
            return;
        }
        await plugin.commands.executeCommand('arduinoFirstRunAgent.compile');
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.showWiring', () => {
        const brief = context.workspaceState.get('projectBrief');
        if (!brief) {
            plugin.window.showWarningMessage('请先生成项目方案。');
            return;
        }
        if (!dashboardPanel) {
            void plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard').then(() => { if (dashboardPanel)
                dashboardPanel.webview.html = themedAgentHtml(wiringDiagramHtml(brief)); });
            return;
        }
        dashboardPanel.webview.html = themedAgentHtml(wiringDiagramHtml(brief));
        dashboardPanel.reveal(plugin.ViewColumn.Two, false);
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.createProject', async (retryGoal) => {
        // Arduino IDE 会跨操作保留旧通知；开始新生成前主动清空，避免旧错误与新状态叠加。
        // Arduino IDE/Theia versions expose different notification commands.
        // Clearing stale notifications is helpful, but must never block generation.
        try {
            await plugin.commands.executeCommand('notifications.clearAll');
        }
        catch {
            try {
                await plugin.commands.executeCommand('workbench.action.clearNotifications');
            }
            catch {
                // Older IDE builds may provide neither command.
            }
        }
        const retryRequest = retryGoal && typeof retryGoal === 'object' ? retryGoal : undefined;
        if (!retryGoal || retryRequest?.showEditor === true) {
            if (typeof retryRequest?.goal === 'string')
                await context.workspaceState.update('projectDraft', retryRequest.goal.trim());
            if (typeof retryRequest?.beginnerMode === 'boolean')
                await context.workspaceState.update('projectDraftBeginner', retryRequest.beginnerMode);
            await context.workspaceState.update('projectComposerVisible', true);
            await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
            return;
        }
        const directRetryGoal = (typeof retryGoal === 'string' ? retryGoal : typeof retryRequest?.goal === 'string' ? retryRequest.goal : '').trim();
        let beginnerMode = retryRequest?.beginnerMode === true;
        const skipBeginnerWizard = typeof retryGoal === 'string' || retryRequest?.skipBeginnerWizard === true;
        // 新项目的模式与长描述统一在项目看板的大输入区选择；这里只处理已提交的数据。
        const rawGoal = directRetryGoal;
        if (!rawGoal) {
            await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
            return;
        }
        if (beginnerMode)
            await context.workspaceState.update('lastBeginnerIdea', rawGoal);
        await setWorkflow({ phase: 'understanding', status: 'running', message: '正在理解项目目标和硬件约束。', startedAt: new Date().toISOString(), error: undefined, revision: workflow().revision + 1 });
        let generated;
        const settings = plugin.workspace.getConfiguration('arduinoAgent');
        const baseUrl = settings.get('baseUrl', 'http://localhost:11434/v1');
        const localAi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl);
        const apiKey = await context.secrets.get('arduinoAgent.apiKey') || settings.get('apiKey') || process.env.OPENAI_API_KEY || (localAi ? 'ollama' : '');
        if (!apiKey) {
            const action = await plugin.window.showWarningMessage('尚未配置 AI 服务。通用项目生成需要本地或兼容 AI 服务。', '打开设置');
            if (action === '打开设置')
                await plugin.commands.executeCommand('workbench.action.openSettings', 'arduinoAgent');
            return;
        }
        const models = resolveModelRoles(settings);
        const codeModel = models.code;
        const planningModel = models.planning;
        const reviewModel = models.review;
        let goal = rawGoal;
        if (beginnerMode && !skipBeginnerWizard) {
            try {
                const confirmedGoal = await beginnerRequirementWizard(rawGoal, apiKey, baseUrl, planningModel, context, dashboardPanel, renderDashboard);
                if (!confirmedGoal) {
                    await setWorkflow({ phase: 'idle', status: 'needs-user', message: '硬件或详细方案尚未确认，可以重新开始选择。', error: undefined });
                    return;
                }
                await context.workspaceState.update('beginnerHardwareDraft', undefined);
                goal = confirmedGoal;
            }
            catch (error) {
                const detail = error instanceof Error ? error.message : String(error);
                await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'blocked', status: 'error', message: '初学者硬件推荐或详细方案生成失败，可以恢复重试。', error: detail }), { tool: 'generator', ok: false, summary: '初学者方案向导失败', detail }));
                await offerGenerationRecovery({ message: 'AI 暂时没能整理出完整方案，已保留你的描述。', detail, currentGoal: rawGoal, originalGoal: rawGoal, beginnerMode: true });
                return;
            }
        }
        await context.workspaceState.update('lastProjectGoal', goal);
        try {
            await setWorkflow({ phase: 'generating', status: 'running', message: '正在规划硬件、接线、验收标准并生成完整代码。' });
            generated = await plugin.window.withProgress({ location: plugin.ProgressLocation.Notification, title: 'Arduino Agent 正在生成项目', cancellable: false }, async (progress) => {
                const startedAt = Date.now();
                let phase = '规划硬件、接线并生成完整代码';
                progress.report({ message: `${phase}…` });
                const ticker = setInterval(() => progress.report({ message: `${phase}（已用时 ${Math.floor((Date.now() - startedAt) / 1000)} 秒）…` }), 10000);
                try {
                    return await generateAuditedProject(goal, apiKey, baseUrl, { planning: planningModel, code: codeModel, review: reviewModel }, next => {
                        phase = next;
                        progress.report({ message: `${phase}…` });
                    });
                }
                finally {
                    clearInterval(ticker);
                }
            });
        }
        catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            const behaviorFailure = /行为门禁|可执行结构/.test(detail);
            const hardwareFailure = /硬件方案|接线校验|端子或接口/.test(detail);
            const serviceFailure = /(?:408|409|425|429|500|502|503|504)|网关|请求过多|额度|AI 服务.*(?:超时|不可用|异常)|无法连接 AI 服务/i.test(detail);
            const message = serviceFailure ? 'AI 服务暂时没有完成响应，需求和硬件选择均已保留。' : behaviorFailure ? '生成代码没有完整实现项目行为，Agent 已阻止保存。' : hardwareFailure ? '硬件资料或接线未通过安全校验。' : '项目生成失败，Agent 已保留当前进度。';
            await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'blocked', status: 'error', message, error: detail }), { tool: 'generator', ok: false, summary: behaviorFailure ? '代码行为门禁未通过' : hardwareFailure ? '硬件方案校验未通过' : '项目生成失败', detail }));
            await offerGenerationRecovery({ message, detail, currentGoal: goal, originalGoal: rawGoal, beginnerMode });
            return;
        }
        const specIssues = [...(0, workflow_1.evaluateProjectSpec)(generated.spec), ...(0, hardwareCatalog_1.evaluateSpecHardware)(generated.spec)];
        if (specIssues.length) {
            generated.spec.risks = [...new Set([...generated.spec.risks, ...specIssues.map(issue => `方案待确认：${issue}`)])];
        }
        // Code evidence is only awarded after the deterministic and executable gates.
        generated.spec.acceptance.filter(item => item.evidence === 'code').forEach(item => { item.passed = true; });
        await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'plan-review', status: 'needs-user', message: '方案已经生成，请确认后再写入工程。', spec: generated.spec }), { tool: 'generator', ok: true, summary: '已生成结构化项目方案和完整代码' }));
        const planDecision = await confirmGeneratedPlanInPanel(generated, dashboardPanel, renderDashboard);
        if (planDecision === 'revise') {
            await context.workspaceState.update('projectDraft', rawGoal);
            await context.workspaceState.update('projectDraftBeginner', beginnerMode);
            renderDashboard();
            return;
        }
        if (planDecision !== 'confirm') {
            await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), {
                phase: 'blocked', status: 'error', message: '方案确认页面被关闭，需求已保留，可以继续重试。',
                error: '尚未确认生成方案，因此没有写入或覆盖任何 Arduino 工程文件。'
            }), { tool: 'user', ok: false, summary: '方案确认被中断' }));
            return;
        }
        generated.spec.board.confirmed = true;
        await setWorkflow({ phase: 'generating', status: 'running', message: '方案已确认，正在写入Arduino工程。', spec: generated.spec });
        let fatalIssues = [...validateProjectCode(generated.code, generated), ...(0, hardwareCatalog_1.evaluateHardwareCode)(goal, generated.code)];
        const coverageIssues = validateRequirementCoverage(goal, generated);
        if (fatalIssues.length) {
            await offerGenerationRecovery({ message: '代码结构还不完整，Agent 已阻止保存错误版本。', detail: fatalIssues.join('；'), currentGoal: goal, originalGoal: rawGoal, beginnerMode });
            return;
        }
        if (coverageIssues.length) {
            await offerGenerationRecovery({ message: '代码还没有完整实现你的效果，Agent 已阻止保存错误版本。', detail: coverageIssues.join('；'), currentGoal: goal, originalGoal: rawGoal, beginnerMode });
            return;
        }
        const activeDocument = plugin.window.activeTextEditor?.document;
        const previousBrief = context.workspaceState.get('projectBrief');
        const currentIsAgentProject = Boolean(activeDocument && previousBrief?.projectFile && activeDocument.uri.fsPath.toLowerCase() === previousBrief.projectFile.toLowerCase());
        const activePath = activeDocument?.uri.fsPath || '';
        const useCurrentBlankSketch = Boolean(activePath.toLowerCase().endsWith('.ino') && !isTemporarySketchPath(activePath) && canonicalSketchUri(plugin.Uri.file(activePath)).fsPath.toLowerCase() === activePath.toLowerCase() && (isBlankStarterSketch(activeDocument.getText()) || currentIsAgentProject));
        let uri;
        if (useCurrentBlankSketch && activeDocument) {
            uri = activeDocument.uri;
            const edit = new plugin.WorkspaceEdit();
            edit.replace(uri, new plugin.Range(activeDocument.positionAt(0), activeDocument.positionAt(activeDocument.getText().length)), generated.code);
            if (!(await plugin.workspace.applyEdit(edit))) {
                plugin.window.showErrorMessage('无法把代码写入当前草稿。');
                return;
            }
            await activeDocument.save();
        }
        else {
            const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
            const projectName = `agent_project_${stamp}`;
            const projectRoot = defaultProjectRoot();
            await plugin.workspace.fs.createDirectory(plugin.Uri.file(projectRoot));
            const selectedUri = await plugin.window.showSaveDialog({ title: '保存 Agent 生成的 Arduino 工程（默认保存到 D 盘）', defaultUri: plugin.Uri.file((0, path_1.join)(projectRoot, projectName, `${projectName}.ino`)), filters: { 'Arduino Sketch': ['ino'] } });
            if (!selectedUri)
                return;
            uri = canonicalSketchUri(selectedUri);
            if (uri.fsPath.toLowerCase() !== selectedUri.fsPath.toLowerCase())
                plugin.window.showInformationMessage(`已按 Arduino 工程规则自动保存到：${uri.fsPath}`);
            const parent = plugin.Uri.file((0, path_1.dirname)(uri.fsPath));
            await plugin.workspace.fs.createDirectory(parent);
            await plugin.workspace.fs.writeFile(uri, Buffer.from(generated.code, 'utf8'));
        }
        await setWorkflow({ phase: 'dependencies', status: 'running', message: '正在查询 Arduino Library Registry，并安装代码所需的真实库。', projectFile: uri.fsPath, spec: generated.spec });
        plugin.window.showInformationMessage('正在根据代码头文件检查并安装真实代码库…');
        const installFailures = await installProjectLibraries(generated);
        const installedLibraries = (await installedLibraryDetails(generated.libraries || [])).map(({ name, version, license, website }) => ({ name, version, license, website }));
        if (installFailures.length)
            plugin.window.showWarningMessage(`部分代码库自动安装失败，将由真实编译和修复流程继续处理：${installFailures.map(item => item.split(':')[0]).join('、')}`);
        plugin.window.showInformationMessage('正在自动编译生成的代码…');
        await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'dependencies', status: installFailures.length ? 'error' : 'success', message: installFailures.length ? '部分代码库安装失败，真实编译将继续定位缺失依赖。' : '代码库安装及版本、许可证查询完成。', projectFile: uri.fsPath, spec: generated.spec, installedLibraries }), { tool: 'library', ok: !installFailures.length, summary: installFailures.length ? '部分代码库安装失败' : `已核对 ${installedLibraries.length} 个代码库`, detail: installFailures.join('\n') || installedLibraries.map(item => `${item.name} ${item.version} · ${item.license}`).join('\n') }));
        await setWorkflow({ phase: 'compiling', status: 'running', message: `正在为 ${generated.spec.board.name} 真实编译。` });
        let compileResult = await compileWithPlatformRecovery((0, path_1.dirname)(uri.fsPath), generated.spec.board.fqbn);
        const resolvedHeaders = new Set();
        for (let dependencyAttempt = 0; dependencyAttempt < 8 && compileResult.code !== 0; dependencyAttempt++) {
            const resolution = await installMissingHeaderFromLog(compileResult.stderr || compileResult.stdout, generated.spec.board.fqbn);
            if (!resolution.header || !resolution.installed || resolvedHeaders.has(resolution.header.toLowerCase()))
                break;
            resolvedHeaders.add(resolution.header.toLowerCase());
            generated.libraries = [...new Set([...(generated.libraries || []), resolution.installed])];
            plugin.window.showInformationMessage(`已根据编译错误自动安装 ${resolution.installed}，正在重新编译…`);
            compileResult = await compileWithPlatformRecovery((0, path_1.dirname)(uri.fsPath), generated.spec.board.fqbn);
        }
        if (compileResult.code !== 0) {
            const settings = plugin.workspace.getConfiguration('arduinoAgent');
            const baseUrl = settings.get('baseUrl', 'http://localhost:11434/v1');
            const localAi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl);
            const apiKey = await context.secrets.get('arduinoAgent.apiKey') || settings.get('apiKey') || process.env.OPENAI_API_KEY || (localAi ? 'ollama' : '');
            const model = resolveModelRoles(settings).code;
            let repairFailure = '';
            for (let attempt = 0; attempt < 4 && compileResult.code !== 0 && apiKey; attempt++) {
                plugin.window.showInformationMessage(`自动编译失败，代码模型正在进行第 ${attempt + 1} 轮修复…`);
                try {
                    const compilerLog = (compileResult.stderr || compileResult.stdout).slice(-6000);
                    const repaired = await repairGeneratedProject(goal, generated, [`Arduino 编译器错误：${compilerLog}`], apiKey, baseUrl, model);
                    const repairedIssues = validateExecutableStructure(repaired.code);
                    if (repairedIssues.length) {
                        repairFailure = `修复后代码结构仍不完整：${repairedIssues.join('；')}`;
                        break;
                    }
                    if (repaired.code.trim() === generated.code.trim()) {
                        repairFailure = 'AI 返回了相同的代码，没有修复编译错误';
                        break;
                    }
                    generated = repaired;
                    await installProjectLibraries(generated);
                    await plugin.workspace.fs.writeFile(uri, Buffer.from(generated.code, 'utf8'));
                    compileResult = await compileWithPlatformRecovery((0, path_1.dirname)(uri.fsPath), generated.spec.board.fqbn);
                }
                catch (error) {
                    repairFailure = error instanceof Error ? error.message : String(error);
                    break;
                }
            }
            if (repairFailure && compileResult.code !== 0)
                compileResult.stderr += `\n自动修复未完成：${repairFailure}`;
        }
        const brief = { goal: generated.goal, sensor: generated.sensor, output: generated.output, sensorPin: generated.sensorPin, outputPin: generated.outputPin, wiringConfirmed: false, libraries: generated.libraries, wiring: generated.wiring, spec: generated.spec };
        brief.projectFile = uri.fsPath;
        await context.workspaceState.update('projectBrief', brief);
        agentProvider.refresh();
        const compileWorkflow = (0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), {
            phase: compileResult.code === 0 ? 'wiring' : 'blocked',
            status: compileResult.code === 0 ? 'needs-user' : 'error',
            message: compileResult.code === 0 ? '代码已真实编译通过，请按接线表核对实物。' : '自动编译和修复仍未通过，请查看错误证据。',
            error: compileResult.code === 0 ? undefined : (compileResult.stderr || compileResult.stdout).slice(-2000),
            projectFile: uri.fsPath, spec: generated.spec
        }), { tool: 'compiler', ok: compileResult.code === 0, summary: compileResult.code === 0 ? `${generated.spec.board.name} 编译通过` : '自动编译仍有错误', detail: (compileResult.stderr || compileResult.stdout).slice(-3000) });
        if (compileResult.code === 0) {
            generated.spec.acceptance.filter(item => item.evidence === 'compile').forEach(item => { item.passed = true; });
        }
        await saveWorkflow(compileWorkflow);
        const doc = await plugin.workspace.openTextDocument(uri);
        await showTextDocumentOnce(doc, plugin.ViewColumn.One);
        if (dashboardPanel)
            dashboardPanel.reveal(plugin.ViewColumn.Two, true);
        if (compileResult.code === 0)
            await plugin.commands.executeCommand('arduinoFirstRunAgent.showWiring');
        else
            await showDiagnosis(compileResult.stderr || compileResult.stdout, context, () => agentProvider.refresh());
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.confirmWiring', async (source) => {
        const brief = context.workspaceState.get('projectBrief');
        if (!brief) {
            plugin.window.showWarningMessage('请先创建项目方案。');
            return;
        }
        if (source !== 'diagram-confirmed') {
            await plugin.commands.executeCommand('arduinoFirstRunAgent.showWiring');
            return;
        }
        brief.wiringConfirmed = true;
        if (brief.spec)
            brief.spec.connections.forEach(connection => { connection.confirmed = true; });
        await context.workspaceState.update('projectBrief', brief);
        await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'device', status: 'needs-user', message: '接线已由用户逐项确认，下一步识别主板和串口。', spec: brief.spec || workflow().spec }), { tool: 'user', ok: true, summary: '用户确认全部接线' }));
        agentProvider.refresh();
        await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
        await plugin.commands.executeCommand('arduinoFirstRunAgent.scan');
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.scan', async () => {
        const now = Date.now();
        if (now - lastScanAt < 1200)
            return;
        lastScanAt = now;
        const r = await runCli(['board', 'list', '--format', 'json']);
        if (r.code !== 0) {
            await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'blocked', status: 'error', message: 'Arduino CLI未能扫描设备。', error: r.stderr || r.stdout }), { tool: 'device-scan', ok: false, summary: '设备扫描失败', detail: r.stderr || r.stdout }));
            plugin.window.showErrorMessage('Arduino CLI 未能启动');
            return;
        }
        const result = scanSummary(r.stdout);
        const targets = uploadTargets(r.stdout);
        await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: targets.length ? 'upload-ready' : 'device', status: targets.length ? 'needs-user' : 'error', message: targets.length ? `检测到 ${targets.length} 个可用设备，请确认上传目标。` : '未检测到可用设备，请检查数据线和驱动。', error: targets.length ? undefined : '没有带VID的USB串口' }), { tool: 'device-scan', ok: targets.length > 0, summary: targets.length ? `检测到 ${targets.map(item => item.address).join('、')}` : '没有检测到可用USB设备' }));
        plugin.window.showInformationMessage(`${result.env} · ${result.advice}`);
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.compile', async () => {
        const brief = context.workspaceState.get('projectBrief');
        const preferredFile = brief?.projectFile && (0, fs_1.existsSync)(brief.projectFile) ? brief.projectFile : currentSketch()?.file;
        if (!preferredFile) {
            plugin.window.showWarningMessage('请先打开要检查的 .ino 文件。');
            return;
        }
        const layout = await ensureSketchLayout(preferredFile);
        const sketch = { file: layout.file, folder: (0, path_1.dirname)(layout.file) };
        if (layout.migrated && brief) {
            brief.projectFile = layout.file;
            await context.workspaceState.update('projectBrief', brief);
            await setWorkflow({ projectFile: layout.file, message: '已自动修正 Arduino 工程目录，正在重新编译。' });
            plugin.window.showInformationMessage(`已自动建立标准工程目录：${sketch.folder}`);
        }
        const activeSpec = brief?.spec || workflow().spec;
        const fqbn = activeSpec?.board.fqbn || 'arduino:avr:uno';
        await setWorkflow({ phase: 'compiling', status: 'running', message: `正在使用 ${fqbn} 编译当前工程。`, error: undefined });
        plugin.window.showInformationMessage(`正在编译当前工程：${sketch.folder}`);
        let r = await compileWithPlatformRecovery(sketch.folder, fqbn);
        if (r.code !== 0 && brief && activeSpec) {
            const settings = plugin.workspace.getConfiguration('arduinoAgent');
            const baseUrl = settings.get('baseUrl', 'http://localhost:11434/v1');
            const localAi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl);
            const apiKey = await context.secrets.get('arduinoAgent.apiKey') || settings.get('apiKey') || process.env.OPENAI_API_KEY || (localAi ? 'ollama' : '');
            let repairFailure = '';
            for (let attempt = 0; attempt < 4 && r.code !== 0 && apiKey; attempt++) {
                try {
                    const currentCode = Buffer.from(await plugin.workspace.fs.readFile(plugin.Uri.file(sketch.file))).toString('utf8');
                    const draft = { ...brief, spec: activeSpec, code: currentCode };
                    const repaired = await repairGeneratedProject(brief.goal, draft, [`Arduino 编译器错误：${(r.stderr || r.stdout).slice(-6000)}`], apiKey, baseUrl, resolveModelRoles(settings).code);
                    if (repaired.code.trim() === currentCode.trim()) {
                        repairFailure = 'AI 返回了相同的代码，没有修复编译错误';
                        break;
                    }
                    for (const library of librariesFromCode(repaired.code))
                        await runCli(['lib', 'install', library]);
                    await plugin.workspace.fs.writeFile(plugin.Uri.file(sketch.file), Buffer.from(repaired.code, 'utf8'));
                    r = await compileWithPlatformRecovery(sketch.folder, fqbn);
                }
                catch (error) {
                    repairFailure = error instanceof Error ? error.message : String(error);
                    break;
                }
            }
            if (repairFailure && r.code !== 0)
                r.stderr += `\n自动修复未完成：${repairFailure}`;
        }
        await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: r.code === 0 ? (brief?.wiringConfirmed ? 'device' : 'wiring') : 'blocked', status: r.code === 0 ? 'needs-user' : 'error', message: r.code === 0 ? '代码真实编译通过。' : '编译失败，请查看诊断并修复。', error: r.code === 0 ? undefined : (r.stderr || r.stdout).slice(-2000) }), { tool: 'compiler', ok: r.code === 0, summary: r.code === 0 ? `${fqbn} 编译通过` : '编译失败', detail: (r.stderr || r.stdout).slice(-3000) }));
        await showTextDocumentOnce(await plugin.workspace.openTextDocument(sketch.file), plugin.ViewColumn.One);
        if (dashboardPanel)
            dashboardPanel.reveal(plugin.ViewColumn.Two, true);
        r.code === 0 ? plugin.window.showInformationMessage('当前代码编译成功，可以进入上传验证。') : await showDiagnosis(r.stderr || r.stdout, context, () => agentProvider.refresh());
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.upload', async () => {
        const brief = context.workspaceState.get('projectBrief');
        if (brief && !brief.wiringConfirmed) {
            plugin.window.showWarningMessage('接线尚未确认。为避免错误接线带来的风险，暂不上传。');
            return;
        }
        const r = await uploadCurrentSketch();
        if (r.code !== 0) {
            await showDiagnosis(r.stderr || r.stdout, context, () => agentProvider.refresh());
            return;
        }
        await plugin.commands.executeCommand('arduinoFirstRunAgent.behavior');
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.behavior', async (initial) => {
        const request = initial && typeof initial === 'object' ? initial : undefined;
        const symptom = typeof initial === 'string' ? initial : typeof request?.symptom === 'string' ? request.symptom : '';
        if (!symptom) {
            const currentBrief = context.workspaceState.get('projectBrief');
            if (!dashboardPanel)
                await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
            if (dashboardPanel)
                dashboardPanel.webview.html = themedAgentHtml(behaviorFeedbackHtml(currentBrief?.goal || '请观察项目的实际运行效果', workflow().spec || currentBrief?.spec));
            return;
        }
        if (!symptom)
            return;
        if (symptom === '运行正常') {
            const state = workflow();
            if (state.spec) {
                const ids = Array.isArray(request?.confirmedIds) ? request.confirmedIds.filter((id) => typeof id === 'string') : [];
                const checked = (0, workflow_1.confirmObservedCriteria)(state.spec, ids);
                if (checked.remaining > 0) {
                    await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(state, { phase: 'observing', status: 'needs-user', message: `已确认 ${checked.confirmed} 项实物效果，仍有 ${checked.remaining} 项需要观察。` }), { tool: 'user', ok: false, summary: `仍有 ${checked.remaining} 项实物效果未确认` }));
                    plugin.window.showInformationMessage('已保留你的核对进度；没有亲眼验证的效果不会自动标为通过。');
                    return;
                }
            }
            await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(state, { phase: 'completed', status: 'success', message: '用户确认实物效果达到目标，项目闭环完成。', error: undefined }), { tool: 'user', ok: true, summary: '用户确认实物运行正常并达到预期' }));
            plugin.window.showInformationMessage('已确认实物运行正常，项目已完成。');
            return;
        }
        const detail = typeof request?.detail === 'string' && request.detail.trim() ? request.detail.trim() : symptom === '没有反应' ? '设备没有反应，需要检查串口诊断、接线和输入输出状态。' : '实际效果与原始需求不一致，需要根据当前代码和实物现象调整。';
        await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'revising', status: 'needs-user', message: `已记录实物反馈：${symptom}。请选择诊断或修改方式。`, error: undefined }), { tool: 'user', ok: false, summary: symptom, detail }));
        const brief = context.workspaceState.get('projectBrief');
        const inputNames = brief?.spec?.components.filter(item => item.role === 'input').map(item => item.name).join('、') || '输入模块';
        const outputNames = brief?.spec?.components.filter(item => item.role === 'output').map(item => item.name).join('、') || '输出模块';
        const advice = symptom === '没有反应'
            ? `建议先断电核对接线表的供电、共地与信号方向；重新上电后观察串口中“${inputNames}”的数据是否随环境变化，再检查“${outputNames}”是否有合适的独立电源和驱动器。Agent 无法通过普通 USB 看见实际导线，请不要在通电时改线。`
            : `先对照最初的目标与逐项验收标准，描述“${inputNames}”的串口读数和“${outputNames}”的实际表现。Agent 会基于当前项目的代码与反馈调整阈值、状态或时序；一次只改变一组可验证的行为。`;
        const target = brief ? `最初目标：“${brief.goal}”。` : '';
        const action = typeof request?.action === 'string' ? request.action : '';
        if (!action) {
            if (!dashboardPanel)
                await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
            if (dashboardPanel)
                dashboardPanel.webview.html = themedAgentHtml(behaviorDiagnosisHtml(target, symptom, detail, advice));
            return;
        }
        if (action === 'back') {
            renderDashboard();
            return;
        }
        if (action === 'ai') {
            if (!brief?.projectFile || !(0, fs_1.existsSync)(brief.projectFile)) {
                plugin.window.showWarningMessage('找不到当前项目文件，请先打开生成的 .ino 工程。');
                return;
            }
            const settings = plugin.workspace.getConfiguration('arduinoAgent');
            const baseUrl = settings.get('baseUrl', 'http://localhost:11434/v1');
            const localAi = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(baseUrl);
            const apiKey = await context.secrets.get('arduinoAgent.apiKey') || settings.get('apiKey') || process.env.OPENAI_API_KEY || (localAi ? 'ollama' : '');
            if (!apiKey) {
                const action = await plugin.window.showWarningMessage('尚未配置 AI 服务。请先在 Arduino Agent 设置中填写 API Key。', '打开设置');
                if (action === '打开设置')
                    await plugin.commands.executeCommand('workbench.action.openSettings', 'arduinoAgent');
                return;
            }
            try {
                await setWorkflow({ phase: 'revising', status: 'running', message: '代码模型正在根据最初目标和实物反馈修改代码。', error: undefined });
                const doc = await plugin.workspace.openTextDocument(brief.projectFile);
                const before = doc.getText();
                const revision = await improveProject(brief, before, detail, apiKey, baseUrl, resolveModelRoles(settings).code);
                const issues = validateProjectCode(revision.code, brief);
                if (issues.length) {
                    plugin.window.showErrorMessage(`AI 修改未通过基础检查：${issues.join('；')}`);
                    return;
                }
                const confirmed = await confirmRevisionInPanel(revision, dashboardPanel, renderDashboard);
                if (!confirmed)
                    return;
                const edit = new plugin.WorkspaceEdit();
                edit.replace(doc.uri, new plugin.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), revision.code);
                await plugin.workspace.applyEdit(edit);
                await doc.save();
                await addRecord(context, { time: new Date().toLocaleString('zh-CN'), file: brief.projectFile, reason: `根据用户反馈修改：${detail}`, before, after: revision.code }, () => agentProvider.refresh());
                await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'compiling', status: 'needs-user', message: '代码修改已应用，下一步必须重新编译验证。', revision: workflow().revision + 1 }), { tool: 'generator', ok: true, summary: `已根据实物反馈生成第 ${workflow().revision + 1} 版代码`, detail: revision.summary }));
                await plugin.commands.executeCommand('arduinoFirstRunAgent.compile');
            }
            catch (error) {
                await saveWorkflow((0, workflow_1.addEvidence)((0, workflow_1.updateWorkflow)(workflow(), { phase: 'blocked', status: 'error', message: 'AI 修改失败，可检查本地模型后重试。', error: error instanceof Error ? error.message : String(error) }), { tool: 'generator', ok: false, summary: '根据实物反馈修改失败', detail: error instanceof Error ? error.message : String(error) }));
                plugin.window.showErrorMessage(`AI 修改失败：${error instanceof Error ? error.message : String(error)}`);
            }
            return;
        }
        if (action === 'open') {
            const projectFile = brief?.projectFile && (0, fs_1.existsSync)(brief.projectFile) ? brief.projectFile : currentSketch()?.file;
            if (projectFile)
                await plugin.window.showTextDocument(await plugin.workspace.openTextDocument(projectFile));
            else
                plugin.window.showWarningMessage('找不到当前 Agent 项目文件。');
        }
        if (action === 'compile')
            await plugin.commands.executeCommand('arduinoFirstRunAgent.compile');
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.showRecord', async (index) => {
        const record = context.workspaceState.get('changeRecords', [])[index];
        if (!record)
            return;
        recordDocument.update(record);
        const doc = await plugin.workspace.openTextDocument(recordDocument.uri);
        await plugin.window.showTextDocument(doc, { preview: true, preserveFocus: false });
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.deleteRecord', async () => {
        const records = context.workspaceState.get('changeRecords', []);
        if (!records.length)
            return;
        const choices = [
            { label: '$(trash) 清空全部记录', description: `删除 ${records.length} 条记录`, index: -1 },
            ...records.map((record, index) => ({ label: record.reason, description: `${record.time} · ${record.file}`, index }))
        ];
        const selected = await plugin.window.showQuickPick(choices, { placeHolder: '选择要删除的修改记录' });
        if (!selected)
            return;
        const message = selected.index === -1 ? `确定清空全部 ${records.length} 条修改记录吗？` : `确定删除“${records[selected.index].reason}”吗？`;
        const confirmed = await plugin.window.showWarningMessage(message, { modal: true }, '删除');
        if (confirmed !== '删除')
            return;
        const next = selected.index === -1 ? [] : records.filter((_, index) => index !== selected.index);
        await context.workspaceState.update('changeRecords', next);
        agentProvider.refresh();
        plugin.window.showInformationMessage(selected.index === -1 ? '已清空全部修改记录。' : '已删除所选修改记录。');
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.open', async () => {
        await plugin.commands.executeCommand('workbench.view.extension.arduinoFirstRunAgent');
        await plugin.commands.executeCommand('arduinoFirstRunAgent.dashboard');
    }));
}
// VS Code/Theia-compatible entry point used by Arduino IDE's VSIX loader.
function activate(context) {
    start(context);
}
//# sourceMappingURL=extension.js.map