const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'extension.ts'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const registered = new Set([...source.matchAll(/registerCommand\('([^']+)'/g)].map(match => match[1]));
const contributed = new Set((pkg.contributes.commands || []).map(item => item.command));
const webviewCommands = new Set([...source.matchAll(/data-command="(arduinoFirstRunAgent\.[A-Za-z0-9]+)"/g)].map(match => match[1]));

for (const command of contributed) assert.ok(registered.has(command), `contributed command is not registered: ${command}`);
for (const command of webviewCommands) assert.ok(registered.has(command), `webview button points to an unregistered command: ${command}`);

const postedMessages = new Set([...source.matchAll(/postMessage\(\{type:'([^']+)'/g)].map(match => match[1]));
const handledMessages = new Set([
  ...[...source.matchAll(/message\.type\s*===\s*'([^']+)'/g)].map(match => match[1]),
  ...[...source.matchAll(/message\.type\s*!==\s*'([^']+)'/g)].map(match => match[1])
]);
for (const type of postedMessages) assert.ok(handledMessages.has(type), `webview message has no receiver: ${type}`);

const rawAssignments = [...source.matchAll(/([A-Za-z][A-Za-z0-9]*)\.webview\.html\s*=\s*`/g)];
for (const match of rawAssignments) {
  const receiver = match[1];
  const selfTheme = new RegExp(`${receiver}\\.webview\\.html\\s*=\\s*themedAgentHtml\\(${receiver}\\.webview\\.html\\)`);
  assert.match(source, selfTheme, `raw ${receiver} webview HTML must be passed through the shared high-contrast theme`);
}

assert.match(source, /saveStartupSettings/);
assert.match(source, /saveAiSettings/);
assert.match(source, /data-command="arduinoFirstRunAgent\.toggleDashboard"/);
console.log('interaction integrity tests passed');
