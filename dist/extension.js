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
const path_1 = require("path");
const os_1 = require("os");
function cliPath() {
    const candidates = [
        (0, path_1.join)((0, path_1.dirname)(process.execPath), 'resources', 'app', 'lib', 'backend', 'resources', 'arduino-cli.exe'),
        'D:\\编程\\Arduino IDE\\resources\\app\\lib\\backend\\resources\\arduino-cli.exe'
    ];
    return candidates.find(fs_1.existsSync) || 'arduino-cli';
}
function runCli(args, cwd) {
    return new Promise(resolve => {
        (0, child_process_1.execFile)(cliPath(), args, { timeout: 30000, cwd }, (error, stdout, stderr) => {
            const exitCode = error ? Number(error.code) || 1 : 0;
            resolve({ code: exitCode, stdout, stderr });
        });
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
            advice: `编译器在第 ${line || '对应'} 行发现语句没有正常结束。请先检查这一行的上一条语句，并在末尾补上分号“;”${before ? `。当前错误在 ${before} 之前暴露` : ''}。补完后重新点击“编译检查”，不需要重写整份代码。`,
            fixKind: 'semicolon'
        };
    }
    if (t.includes('no such file or directory') && /#include|fatal error/.test(t)) {
        const header = text.match(/fatal error:\s*([^:\r\n]+):\s*No such file/i)?.[1]?.trim();
        const isNeoPixel = Boolean(header && /neopixel/i.test(header));
        return { title: '缺少代码库', file, line, column, header, library: isNeoPixel ? 'Adafruit NeoPixel' : undefined, correctedHeader: isNeoPixel ? 'Adafruit_NeoPixel.h' : undefined, fixKind: 'library', advice: `找不到 ${header || '代码引用的头文件'}。${isNeoPixel ? 'Agent 可以安装 Adafruit NeoPixel，并把错误的引用名改为 Adafruit_NeoPixel.h。' : '请在库管理器安装对应库。'}安装后重新编译；不要修改灯光逻辑。` };
    }
    if (t.includes('was not declared in this scope')) {
        const name = text.match(/['‘]([^'’]+)['’] was not declared/i)?.[1];
        return { title: '名称未定义', file, line, column, advice: `${name ? `“${name}”` : '某个名称'}在使用前没有定义。请检查拼写、变量声明和作用域，然后只修改报错行附近。` };
    }
    if (t.includes('ser_open') || t.includes('port') || t.includes('no such file')) {
        return { title: '串口问题', advice: '请重新插拔主板，在“端口”列表选择新出现的串口；如果没有出现，检查 USB 数据线和驱动。' };
    }
    if (t.includes('board') || t.includes('fqbn') || t.includes('platform')) {
        return { title: '板型或核心问题', advice: '请确认 IDE 里的板型与实物一致，并安装对应的 Arduino AVR Boards 核心。' };
    }
    if (t.includes('not declared') || t.includes('expected') || t.includes('error:')) {
        return { title: '代码编译错误', file, line, column, advice: `错误位置：${line ? `第 ${line} 行` : '日志中的第一条 error'}。请根据第一条错误修改附近代码，然后重新编译。` };
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
function compileArgs(folder) {
    return ['compile', '--fqbn', 'arduino:avr:uno', '--libraries', (0, path_1.join)((0, os_1.homedir)(), 'Documents', 'Arduino', 'libraries'), folder];
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
function html() {
    return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
  body{font-family:Arial,"Microsoft YaHei",sans-serif;padding:14px;color:#26364a;background:#f7f9fc}
  h2{margin:0 0 5px;font-size:18px}.sub{color:#718096;font-size:12px;margin-bottom:14px}
  button{border:0;border-radius:6px;padding:9px 12px;background:#2864f0;color:#fff;cursor:pointer;margin:4px 4px 8px 0}
  button.secondary{background:#e7eefc;color:#2455c3}.row{display:flex;gap:6px;flex-wrap:wrap}
  .status{background:#fff;border:1px solid #dce5f1;border-radius:7px;padding:10px;margin:8px 0;white-space:pre-wrap;font-size:12px;line-height:1.5}
  .label{font-size:11px;color:#708096;text-transform:uppercase;letter-spacing:.06em;margin-top:12px}
  textarea{width:100%;height:100px;box-sizing:border-box;border:1px solid #dce5f1;border-radius:6px;padding:8px;font-family:monospace}
  </style></head><body><h2>首次运行守护 Agent</h2><div class="sub">只协助从代码到第一次成功上传</div>
  <div class="label">当前环境</div><div id="env" class="status">尚未读取</div>
  <div class="row"><button id="scan">扫描主板与串口</button><button id="compile" class="secondary">编译当前项目</button><button id="upload" class="secondary">上传并验证</button></div>
  <div class="label">Agent 建议</div><div id="advice" class="status">先扫描环境。Agent 会把需要你操作的步骤单独标出来。</div>
  <div class="label">粘贴错误日志</div><textarea id="log" placeholder="也可以把 Arduino IDE 的错误日志粘贴到这里"></textarea><button id="diagnose">诊断日志</button>
  <script>
    const vscode = acquireVsCodeApi();
    const $=id=>document.getElementById(id); function send(type,payload={}){vscode.postMessage({type,...payload})}
    $('scan').onclick=()=>send('scan');$('compile').onclick=()=>send('compile');$('upload').onclick=()=>send('upload');$('diagnose').onclick=()=>send('diagnose',{text:$('log').value});
    window.addEventListener('message',e=>{const m=e.data;if(m.type==='result'){$('env').textContent=m.env||$('env').textContent;$('advice').textContent=m.advice||m.text||''}});
  </script></body></html>`;
}
function start(context) {
    let lastScanAt = 0;
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
        constructor(label, command, state = plugin.TreeItemCollapsibleState.None, children = []) {
            super(label);
            this.children = children;
            this.command = command;
            this.collapsibleState = state;
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
            const history = records.map((r, i) => new AgentItem(`${r.time} · ${r.reason}`, { command: 'arduinoFirstRunAgent.showRecord', title: '查看修改记录', arguments: [i] }));
            return [
                new AgentItem('环境检查：主板与串口', { command: 'arduinoFirstRunAgent.scan', title: '检查主板与串口' }),
                new AgentItem('编译检查：当前项目', { command: 'arduinoFirstRunAgent.compile', title: '编译当前项目' }),
                new AgentItem('上传验证：运行实物', { command: 'arduinoFirstRunAgent.upload', title: '上传并验证' }),
                new AgentItem('错误诊断：粘贴日志', { command: 'arduinoFirstRunAgent.diagnose', title: '诊断错误日志' }),
                new AgentItem(`修改记录（${records.length}）`, undefined, plugin.TreeItemCollapsibleState.Expanded, history),
                ...(records.length ? [new AgentItem('删除修改记录…', { command: 'arduinoFirstRunAgent.deleteRecord', title: '删除修改记录' })] : [])
            ];
        }
    }
    const agentProvider = new AgentProvider();
    context.subscriptions.push(plugin.window.registerTreeDataProvider('arduinoFirstRunAgent.tree', agentProvider));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.scan', async () => {
        const now = Date.now();
        if (now - lastScanAt < 1200)
            return;
        lastScanAt = now;
        const r = await runCli(['board', 'list', '--format', 'json']);
        if (r.code !== 0) {
            plugin.window.showErrorMessage('Arduino CLI 未能启动');
            return;
        }
        const result = scanSummary(r.stdout);
        plugin.window.showInformationMessage(`${result.env} · ${result.advice}`);
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.compile', async () => {
        const sketch = currentSketch();
        if (!sketch) {
            plugin.window.showWarningMessage('请先打开要检查的 .ino 文件。');
            return;
        }
        plugin.window.showInformationMessage(`正在编译当前工程：${sketch.folder}`);
        const r = await runCli(compileArgs(sketch.folder), sketch.folder);
        r.code === 0 ? plugin.window.showInformationMessage('当前代码编译成功，可以进入上传验证。') : await showDiagnosis(r.stderr || r.stdout, context, () => agentProvider.refresh());
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.upload', async () => {
        const r = await runCli(['upload', '.']);
        r.code === 0 ? plugin.window.showInformationMessage('上传成功，请观察实物运行。') : await showDiagnosis(r.stderr || r.stdout, context, () => agentProvider.refresh());
    }));
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.diagnose', () => {
        plugin.window.showInputBox({ prompt: '粘贴 Arduino IDE 错误日志', placeHolder: '例如：avrdude、ser_open、error:' }).then(text => {
            if (!text)
                return;
            showDiagnosis(text, context, () => agentProvider.refresh());
        });
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
    const connect = (webview) => {
        webview.options = { enableScripts: true };
        webview.html = html();
        webview.onDidReceiveMessage(async (message) => {
            if (message.type === 'diagnose') {
                const d = diagnosis(String(message.text || ''));
                webview.postMessage({ type: 'result', advice: `${d.title}：${d.advice}` });
                return;
            }
            if (message.type === 'scan') {
                const ports = await runCli(['board', 'list', '--format', 'json']);
                const version = await runCli(['version']);
                const result = ports.code === 0 ? scanSummary(ports.stdout) : { env: `CLI 启动失败\n${version.stderr || ports.stderr}`, advice: '插件未能调用 Arduino CLI。' };
                webview.postMessage({ type: 'result', ...result });
            }
            else if (message.type === 'compile') {
                const sketch = currentSketch();
                if (!sketch) {
                    webview.postMessage({ type: 'result', text: '请先打开要检查的 .ino 文件。' });
                    return;
                }
                const r = await runCli(compileArgs(sketch.folder), sketch.folder);
                const d = diagnosis(r.stderr || r.stdout);
                webview.postMessage({ type: 'result', text: r.code === 0 ? '当前代码编译成功。下一步可以上传。' : `${d.title}：${d.advice}` });
            }
            else if (message.type === 'upload') {
                const r = await runCli(['upload', '.']);
                const d = diagnosis(r.stderr || r.stdout);
                webview.postMessage({ type: 'result', text: r.code === 0 ? '上传成功。请观察实物是否按预期运行。' : `${d.title}：${d.advice}` });
            }
        });
    };
    const view = plugin.window.registerWebviewViewProvider('arduinoFirstRunAgent.view', {
        resolveWebviewView(webviewView) {
            connect(webviewView.webview);
        }
    });
    context.subscriptions.push(view);
    context.subscriptions.push(plugin.commands.registerCommand('arduinoFirstRunAgent.open', () => plugin.commands.executeCommand('workbench.view.extension.arduinoFirstRunAgent')));
}
// VS Code/Theia-compatible entry point used by Arduino IDE's VSIX loader.
function activate(context) {
    start(context);
}
//# sourceMappingURL=extension.js.map