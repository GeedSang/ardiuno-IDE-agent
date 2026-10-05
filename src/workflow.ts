import { isNonElectricalAccessory } from './componentClassification';

export type WorkflowPhase =
  | 'idle'
  | 'understanding'
  | 'plan-review'
  | 'generating'
  | 'dependencies'
  | 'compiling'
  | 'wiring'
  | 'device'
  | 'upload-ready'
  | 'uploading'
  | 'observing'
  | 'revising'
  | 'completed'
  | 'blocked';

export type PhaseStatus = 'waiting' | 'running' | 'needs-user' | 'success' | 'error';

export type BoardSpec = {
  name: string;
  fqbn: string;
  voltage?: string;
  selectionId?: string;
  confirmed: boolean;
};

export type ComponentSpec = {
  id: string;
  name: string;
  model?: string;
  role: 'input' | 'output' | 'controller' | 'power' | 'other';
  interface?: string;
  voltage?: string;
  selectionId?: string;
  addedForSafety?: boolean;
  quantity: number;
};

export type ConnectionSpec = {
  componentId: string;
  componentName: string;
  sourcePin: string;
  target: string;
  targetPin: string;
  signalType?: string;
  voltage?: string;
  required: boolean;
  confirmed: boolean;
};

export type BehaviorSpec = {
  id: string;
  trigger: string;
  action: string;
  parameters: Record<string, string | number | boolean>;
};

export type AcceptanceCriterion = {
  id: string;
  description: string;
  evidence: 'code' | 'compile' | 'upload' | 'user';
  passed: boolean;
};

export type ProjectSpec = {
  version: 1;
  goal: string;
  board: BoardSpec;
  components: ComponentSpec[];
  connections: ConnectionSpec[];
  libraries: string[];
  behaviors: BehaviorSpec[];
  acceptance: AcceptanceCriterion[];
  risks: string[];
};

export type ToolEvidence = {
  at: string;
  tool: 'generator' | 'library' | 'compiler' | 'simulator' | 'device-scan' | 'uploader' | 'user';
  ok: boolean;
  summary: string;
  detail?: string;
};

export type WorkflowState = {
  version: 1;
  phase: WorkflowPhase;
  status: PhaseStatus;
  message: string;
  startedAt?: string;
  updatedAt: string;
  error?: string;
  projectFile?: string;
  spec?: ProjectSpec;
  evidence: ToolEvidence[];
  installedLibraries?: Array<{ name: string; version: string; license: string; website?: string }>;
  simulation?: { status: VerificationStatus; engine?: string; summary: string };
  revision: number;
};

export type VerificationStatus = 'passed' | 'failed' | 'not-run' | 'unavailable';
export type VerificationSummary = {
  wiring: VerificationStatus;
  static: VerificationStatus;
  compile: VerificationStatus;
  simulation: VerificationStatus;
  physical: VerificationStatus;
};

const now = (): string => new Date().toISOString();

export function initialWorkflow(): WorkflowState {
  return { version: 1, phase: 'idle', status: 'waiting', message: '描述想做的项目，Agent 会先形成方案。', updatedAt: now(), evidence: [], revision: 0 };
}

export function updateWorkflow(state: WorkflowState, patch: Partial<WorkflowState>): WorkflowState {
  return { ...state, ...patch, updatedAt: now(), evidence: patch.evidence || state.evidence };
}

export function addEvidence(state: WorkflowState, evidence: Omit<ToolEvidence, 'at'>): WorkflowState {
  // Repeating the same failed step is one recovery attempt, not a new user-facing event.
  // Keep the newest detail and remove older duplicates so the dashboard does not become an error wall.
  const remaining = state.evidence.filter(item => item.tool !== evidence.tool || item.ok !== evidence.ok || item.summary !== evidence.summary);
  return updateWorkflow(state, { evidence: [{ ...evidence, at: now() }, ...remaining].slice(0, 50) });
}

/** Product-facing confidence levels. Passing an earlier level never implies a later one. */
export function verificationSummary(state: WorkflowState): VerificationSummary {
  const spec = state.spec;
  const wiring = !spec ? 'not-run' : evaluateProjectSpec(spec).length ? 'failed' : spec.connections.length ? 'passed' : 'not-run';
  const codeCriteria = spec?.acceptance.filter(item => item.evidence === 'code') || [];
  const generatorFailures = state.evidence.filter(item => item.tool === 'generator' && !item.ok);
  const staticStatus: VerificationStatus = codeCriteria.length && codeCriteria.every(item => item.passed)
    ? 'passed' : generatorFailures.length ? 'failed' : 'not-run';
  const compiler = state.evidence.find(item => item.tool === 'compiler');
  const compile: VerificationStatus = compiler ? (compiler.ok ? 'passed' : 'failed') : 'not-run';
  const physicalCriteria = spec?.acceptance.filter(item => item.evidence === 'user') || [];
  const physical: VerificationStatus = physicalCriteria.length && physicalCriteria.every(item => item.passed) ? 'passed' : 'not-run';
  return { wiring, static: staticStatus, compile, simulation: state.simulation?.status || 'unavailable', physical };
}

/** A successful upload never proves the physical effects; only selected user checks do. */
export function confirmObservedCriteria(spec: ProjectSpec, confirmedIds: readonly string[]): { confirmed: number; remaining: number } {
  const ids = new Set(confirmedIds);
  let confirmed = 0;
  let remaining = 0;
  for (const criterion of spec.acceptance.filter(item => item.evidence === 'user')) {
    if (ids.has(criterion.id)) { criterion.passed = true; confirmed++; }
    if (!criterion.passed) remaining++;
  }
  return { confirmed, remaining };
}

export function phaseLabel(phase: WorkflowPhase): string {
  return ({
    idle: '等待需求', understanding: '理解需求', 'plan-review': '确认方案', generating: '生成代码', dependencies: '安装依赖', compiling: '真实编译', wiring: '确认接线', device: '识别设备', 'upload-ready': '确认上传', uploading: '上传程序', observing: '观察实物', revising: '修改效果', completed: '项目完成', blocked: '需要处理'
  } as Record<WorkflowPhase, string>)[phase];
}

export function nextAction(state: WorkflowState): { label: string; command?: string } {
  switch (state.phase) {
    case 'idle': return { label: '创建项目方案', command: 'arduinoFirstRunAgent.createProject' };
    case 'plan-review': return { label: '查看方案与接线', command: 'arduinoFirstRunAgent.showWiring' };
    case 'wiring': return { label: '逐项确认接线', command: 'arduinoFirstRunAgent.confirmWiring' };
    case 'device': return { label: '扫描主板与串口', command: 'arduinoFirstRunAgent.scan' };
    case 'upload-ready': return { label: '确认并上传', command: 'arduinoFirstRunAgent.upload' };
    case 'observing': return { label: '反馈实物效果', command: 'arduinoFirstRunAgent.behavior' };
    case 'blocked': return { label: '恢复并重试', command: 'arduinoFirstRunAgent.retry' };
    case 'completed': return { label: '已完成，可创建新项目', command: 'arduinoFirstRunAgent.createProject' };
    default: return { label: state.message };
  }
}

const text = (value: unknown, fallback = ''): string => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function normalizeLibraryNames(value: unknown, fallback: string[] = []): string[] {
  const names = list(value).map(item => {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object') return '';
    const library = item as Record<string, unknown>;
    for (const key of ['name', 'library', 'libraryName', 'package', 'id']) {
      const candidate = library[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
  }).filter(name => name && name !== '[object Object]');
  return [...new Set(names.length ? names : fallback.map(name => String(name).trim()).filter(Boolean))];
}

export function codeContainsRequiredNumber(code: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\D)${escaped}(?:\\D|$)`).test(code);
}

export function repairKnownHardwareConnections(spec: ProjectSpec): ProjectSpec {
  const sound = spec.components.find(component => /声音|麦克风|microphone|sound sensor/i.test(`${component.name} ${component.model || ''}`));
  const strip = spec.components.find(component => /WS2812|NeoPixel|可编程灯带/i.test(`${component.name} ${component.model || ''}`));
  if (!sound || !strip) return spec;
  const boardPins = spec.connections.map(connection => connection.targetPin.trim().toUpperCase());
  const analogPin = boardPins.find(pin => /^A\d+$/.test(pin)) || 'A0';
  const digitalPin = boardPins.find(pin => /^D?\d+$/.test(pin) && pin !== analogPin) || 'D6';
  const boardName = spec.board.name || 'Arduino';
  const boardVoltage = /3\.3V/i.test(spec.board.voltage || '') ? '3.3V' : '5V';
  spec.connections = [
    { componentId: sound.id, componentName: sound.name, sourcePin: 'AO', target: boardName, targetPin: analogPin, signalType: 'Analog', required: true, confirmed: false },
    { componentId: sound.id, componentName: sound.name, sourcePin: 'VCC', target: boardName, targetPin: boardVoltage, voltage: boardVoltage, required: true, confirmed: false },
    { componentId: sound.id, componentName: sound.name, sourcePin: 'GND', target: boardName, targetPin: 'GND', required: true, confirmed: false },
    { componentId: strip.id, componentName: strip.name, sourcePin: 'DIN', target: boardName, targetPin: digitalPin.startsWith('D') ? digitalPin : `D${digitalPin}`, signalType: 'Digital', required: true, confirmed: false },
    { componentId: strip.id, componentName: strip.name, sourcePin: 'VCC', target: '独立稳定 5V 电源', targetPin: '5V', voltage: '5V', required: true, confirmed: false },
    { componentId: strip.id, componentName: strip.name, sourcePin: 'GND', target: '独立电源与 Arduino 共地', targetPin: 'GND', required: true, confirmed: false }
  ];
  sound.interface = '模拟输入';
  strip.interface = '单线数字信号';
  if (!spec.libraries.some(name => /Adafruit NeoPixel/i.test(name))) spec.libraries.push('Adafruit NeoPixel');
  return spec;
}

export function normalizeProjectSpec(raw: unknown, fallback: {
  goal: string; sensor: string; output: string; sensorPin: string; outputPin: string; wiring: string[]; libraries: string[];
}): ProjectSpec {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const boardRaw = value.board && typeof value.board === 'object' ? value.board as Record<string, unknown> : {};
  const boardFqbn = text(boardRaw.fqbn, 'arduino:avr:uno');
  const boardVoltage = /^(?:arduino:avr:(?:uno|nano|mini|pro|mega|leonardo|micro))$/i.test(boardFqbn)
    ? '5V'
    : /(?:esp32|esp8266|samd|rp2040|mbed)/i.test(boardFqbn) ? '3.3V' : text(boardRaw.voltage, '5V');
  const components = list(value.components).map((item, index): ComponentSpec => {
    const c = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const role = text(c.role, index === 0 ? 'input' : 'output');
    return {
      id: text(c.id, `component-${index + 1}`), name: text(c.name, index === 0 ? fallback.sensor : fallback.output),
      model: text(c.model) || undefined, role: ['input', 'output', 'controller', 'power', 'other'].includes(role) ? role as ComponentSpec['role'] : 'other',
      interface: text(c.interface) || undefined, voltage: text(c.voltage) || undefined,
      selectionId: text(c.selectionId) || undefined, addedForSafety: c.addedForSafety === true,
      quantity: Math.max(1, Number(c.quantity) || 1)
    };
  });
  if (!components.length) {
    components.push(
      { id: 'input-1', name: fallback.sensor, role: 'input', quantity: 1 },
      { id: 'output-1', name: fallback.output, role: 'output', quantity: 1 }
    );
  }
  const rawConnections = list(value.connections);
  // 小型模型常把信号放在 connections、供电放在兼容字段 wiring。
  // 已有结构化接线时，只从 wiring 补充供电，避免同一信号被重复描述后误判为引脚冲突。
  const powerWiring = fallback.wiring.filter(line => /(?:VCC|GND|GROUND|5V|3\.3V|VIN|电源|共地)/i.test(line));
  const connectionLines = rawConnections.length ? [...rawConnections, ...powerWiring] : fallback.wiring;
  const connections = connectionLines.map((item, index): ConnectionSpec => {
    if (typeof item === 'string') {
      const parts = item.split(/\s*(?:->|→|接到|连接到)\s*/);
      const left = (parts[0] || `连接${index + 1}`).trim();
      const right = (parts.slice(1).join(' -> ') || '待确认').trim();
      const leftParts = left.split(/\s+/); const rightParts = right.split(/\s+/);
      return { componentId: `connection-${index + 1}`, componentName: leftParts.slice(0, -1).join(' ') || left, sourcePin: leftParts.at(-1) || '', target: rightParts.slice(0, -1).join(' ') || right, targetPin: rightParts.at(-1) || '', required: true, confirmed: false };
    }
    const c = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { componentId: text(c.componentId, `connection-${index + 1}`), componentName: text(c.componentName, '未命名元件'), sourcePin: text(c.sourcePin), target: text(c.target, 'Arduino'), targetPin: text(c.targetPin), signalType: text(c.signalType) || undefined, voltage: text(c.voltage) || undefined, required: c.required !== false, confirmed: false };
  }).filter((connection, index, all) => {
    const key = `${connection.componentName}|${connection.sourcePin}|${connection.target}|${connection.targetPin}`.replace(/\s+/g, '').toLowerCase();
    return all.findIndex(candidate => `${candidate.componentName}|${candidate.sourcePin}|${candidate.target}|${candidate.targetPin}`.replace(/\s+/g, '').toLowerCase() === key) === index;
  }).map(connection => {
    const identity = (input: string): string => input.toLowerCase().replace(/(?:display|module|sensor|breakout|模块|传感器|显示屏|执行器)/g, '').replace(/[^a-z0-9\u3400-\u9fff]/g, '');
    // 接线归属只能根据导线左侧元件判断。把 target 参与匹配会把
    // “声音传感器 VCC -> WS2812 VCC”错误归到 WS2812，掩盖危险的跨模块接线。
    const connectionKeys = [connection.componentId, connection.componentName].map(identity).filter(Boolean);
    const match = components.find(component => {
      const componentKeys = [component.id, component.name, component.model || ''].map(identity).filter(Boolean);
      return componentKeys.some(left => connectionKeys.some(right => left === right || left.includes(right) || right.includes(left)));
    });
    return match ? { ...connection, componentId: match.id, componentName: match.name } : connection;
  });
  const behaviorCandidates = list(value.behaviors).map((item, index): BehaviorSpec => {
    const b = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { id: text(b.id, `behavior-${index + 1}`), trigger: text(b.trigger, '持续运行'), action: text(b.action, fallback.goal), parameters: b.parameters && typeof b.parameters === 'object' ? b.parameters as Record<string, string | number | boolean> : {} };
  });
  const behaviorKey = (behavior: BehaviorSpec): string => `${behavior.trigger}|${behavior.action}|${JSON.stringify(behavior.parameters, Object.keys(behavior.parameters).sort())}`.replace(/[\s，。；、,.!?！？;:：]+/g, '').toLowerCase();
  const behaviors = behaviorCandidates.filter((behavior, index, all) => all.findIndex(candidate => behaviorKey(candidate) === behaviorKey(behavior)) === index)
    .map((behavior, index) => ({ ...behavior, id: `behavior-${index + 1}` }));
  if (!behaviors.length) behaviors.push({ id: 'behavior-1', trigger: '项目运行时', action: fallback.goal, parameters: {} });
  const acceptanceCandidates = list(value.acceptance).map((item, index): AcceptanceCriterion => {
    const a = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const evidence = text(a.evidence, 'user');
    return { id: text(a.id, `acceptance-${index + 1}`), description: text(a.description, `验证行为 ${index + 1}`), evidence: ['code', 'compile', 'upload', 'user'].includes(evidence) ? evidence as AcceptanceCriterion['evidence'] : 'user', passed: false };
  });
  const genericAcceptance = /^(?:验证|检查|测试)(?:行为|功能|效果|项目)?\s*\d*$|^(?:verify|test|check)\s*(?:behavior|function|effect)?\s*\d*$/i;
  const acceptance = acceptanceCandidates.filter(item => item.description.trim() && !genericAcceptance.test(item.description.trim()))
    .filter((item, index, all) => all.findIndex(candidate => `${candidate.description}|${candidate.evidence}`.replace(/\s+/g, '').toLowerCase() === `${item.description}|${item.evidence}`.replace(/\s+/g, '').toLowerCase()) === index)
    .map((item, index) => ({ ...item, id: `acceptance-${index + 1}` }));
  if (!acceptance.length) {
    acceptance.push(
      { id: 'code-complete', description: '代码包含完整 setup() 与 loop()', evidence: 'code', passed: false },
      { id: 'compile-pass', description: '目标开发板真实编译通过', evidence: 'compile', passed: false },
      ...behaviors.map((behavior, index): AcceptanceCriterion => ({ id: `effect-${index + 1}`, description: `实物观察：${behavior.action.slice(0, 120)}`, evidence: 'user', passed: false }))
    );
  }
  return {
    version: 1, goal: text(value.goal, fallback.goal),
    board: { name: text(boardRaw.name, 'Arduino Uno'), fqbn: boardFqbn, voltage: boardVoltage, selectionId: text(boardRaw.selectionId) || undefined, confirmed: false },
    components, connections, libraries: normalizeLibraryNames(value.libraries, fallback.libraries),
    behaviors, acceptance, risks: list(value.risks).map(item => {
      if (typeof item === 'string') return item.trim();
      if (!item || typeof item !== 'object') return '';
      const risk = item as Record<string, unknown>;
      for (const key of ['description', 'risk', 'message', 'name']) if (typeof risk[key] === 'string') return String(risk[key]).trim();
      return '';
    }).filter(Boolean)
  };
}

export function evaluateProjectSpec(spec: ProjectSpec): string[] {
  const issues: string[] = [];
  const circuitIntermediary = (value: string): boolean => /驱动|driver|继电器|relay|MOSFET|晶体管|三极管|transistor|二极管|diode|电阻|resistor|电容|capacitor|电感|inductor|保险丝|fuse|光耦|稳压|降压|升压|转换器|电平转换|level\s*(?:shifter|converter)|适配器|电源|电池|端子/i.test(value);
  const indirectTwoWireLoad = (component: ComponentSpec): boolean => /水泵|pump|电机|motor|电磁阀|solenoid|风扇|fan|加热|heater|普通灯(?:条|带|珠)?|植物灯|照明灯|单色.*(?:LED)?灯带|(?:LED)?灯带.*单色|2[- ]?wire.*(?:LED)?strip/i.test(`${component.name} ${component.model || ''}`);
  const sameComponent = (connection: ConnectionSpec, component: ComponentSpec): boolean => {
    const idA = connection.componentId.trim().toLowerCase();
    const idB = component.id.trim().toLowerCase();
    if (idA && idA === idB) return true;
    const clean = (value: string): string => value.toLowerCase().replace(/[\s_\-（）()]/g, '').replace(/(?:模块|传感器|执行器|开发板)$/g, '');
    const nameA = clean(connection.componentName);
    const candidates = [component.name, component.model || '', component.id].map(clean).filter(Boolean);
    return Boolean(nameA && candidates.some(nameB => nameA.includes(nameB) || nameB.includes(nameA)));
  };
  if (!spec.goal.trim()) issues.push('缺少项目目标');
  if (!spec.board.fqbn.trim()) issues.push('缺少可编译的开发板标识');
  if (!spec.components.length) issues.push('缺少元件清单');
  if (!spec.connections.length) issues.push('缺少结构化接线');
  for (const component of spec.components) {
    const owned = spec.connections.filter(connection => sameComponent(connection, component));
    const incoming = spec.connections.filter(connection => {
      if (sameComponent(connection, component) || ![component.name, component.model || ''].filter(Boolean).some(name => `${connection.target || ''}`.toLowerCase().includes(name.toLowerCase()))) return false;
      const owner = spec.components.find(candidate => sameComponent(connection, candidate));
      return Boolean(owner && (owner.role === 'power' || circuitIntermediary(`${owner.name} ${owner.model || ''}`)));
    })
      .map(connection => ({ ...connection, sourcePin: connection.targetPin }));
    const own = [...owned, ...incoming];
    if (component.role !== 'controller' && component.role !== 'power' && !isNonElectricalAccessory(component) && !own.length) issues.push(`${component.name} 没有对应接线`);
    if (component.role === 'input' || component.role === 'output') {
      const signals = own.filter(connection => !/^(?:VCC|VIN|5V|3\.3V|GND|GROUND|\+|-)$/i.test(connection.sourcePin));
      if (!signals.length && !(component.role === 'output' && indirectTwoWireLoad(component))) issues.push(`${component.name} 缺少信号或数据线接线`);
    }
    const componentTextForPower = `${component.name} ${component.model || ''}`;
    const bareDiscreteLed = /(?:^|[^A-Z])LED(?:$|[^A-Z])|发光二极管/i.test(componentTextForPower) && !/灯带|模块|WS281|NeoPixel/i.test(componentTextForPower);
    const passiveSwitch = /按钮|按键|button|switch/i.test(componentTextForPower) && /常开|常闭|轻触|裸|NO|NC/i.test(componentTextForPower) && !/模块|module/i.test(componentTextForPower);
    const passiveMatrix = /(?:\d+\s*[x×*]\s*\d+).*?(?:薄膜)?(?:键盘|keypad)|(?:薄膜)?(?:键盘|keypad).*?(?:\d+\s*[x×*]\s*\d+)/i.test(componentTextForPower) && !/模块|module|I2C/i.test(componentTextForPower);
    if (component.role !== 'controller' && component.role !== 'power' && component.voltage && own.length && !circuitIntermediary(componentTextForPower) && !bareDiscreteLed && !passiveSwitch && !passiveMatrix && !indirectTwoWireLoad(component)) {
      const componentText = componentTextForPower;
      const bareLed = bareDiscreteLed;
      const levelConverter = /电平转换|level\s*(?:shifter|converter)/i.test(componentText);
      const hasPositive = own.some(connection => /^(?:VCC|VIN|3\.3V|\+?5V|\+|正极|PUMP\+|MOTOR\+)$/i.test(connection.sourcePin) || /^(?:VCC|VIN|3\.3V|\+?5V|\+|正极)$/i.test(connection.targetPin)) ||
        (bareLed && own.some(connection => /^(?:A|ANODE|阳极)$/i.test(connection.sourcePin))) ||
        (levelConverter && own.some(connection => /^(?:HV|LV|HVCC|LVCC)$/i.test(connection.sourcePin)));
      const hasGround = own.some(connection => /^(?:GND|GROUND|-|负极|PUMP-|MOTOR-)$/i.test(connection.sourcePin) || /^(?:GND|GROUND|-|负极)$/i.test(connection.targetPin) || /共地/i.test(`${connection.target} ${connection.targetPin}`)) ||
        (bareLed && own.some(connection => /^(?:K|CATHODE|阴极)$/i.test(connection.sourcePin)));
      if (!hasPositive) issues.push(`${component.name} 缺少电源接线`);
      if (!hasGround) issues.push(`${component.name} 缺少 GND 接线`);
    }
  }
  const signalConnections = spec.connections.filter(connection => connectionTargetsBoard(connection, spec));
  const signalTargets = signalConnections.map(connection => connection.targetPin.toUpperCase()).filter(Boolean);
  const duplicates = signalTargets.filter((pin, index) => {
    if (signalTargets.indexOf(pin) === index) return false;
    const onPin = signalConnections.filter(connection => connection.targetPin.toUpperCase() === pin);
    const sharedBus = onPin.every(connection => /I2C|SDA|SCL/i.test(`${connection.signalType || ''} ${connection.sourcePin}`)) ||
      onPin.every(connection => /spi-(?:sck|mosi|miso)|^(?:SCK|MOSI|MISO)$/i.test(`${connection.signalType || ''} ${connection.sourcePin}`.trim()));
    const circuitParts = onPin.filter(connection => circuitIntermediary(connection.componentName));
    const activeOwners = new Set(onPin.filter(connection => !circuitIntermediary(connection.componentName)).map(connection => connection.componentId.trim().toLowerCase()));
    const validCircuitNode = circuitParts.length > 0 && activeOwners.size <= 1;
    return !sharedBus && !validCircuitNode;
  });
  if (duplicates.length) issues.push(`信号引脚可能冲突：${[...new Set(duplicates)].join('、')}`);
  const levelConverters = spec.components.filter(component => /电平转换|level\s*(?:shifter|converter)/i.test(`${component.name} ${component.model || ''} ${component.interface || ''}`));
  for (const converter of levelConverters) {
    const ownPins = spec.connections.filter(connection => sameComponent(connection, converter)).map(connection => connection.sourcePin.toUpperCase());
    const incomingPins = spec.connections.filter(connection => [converter.name, converter.model || ''].filter(Boolean).some(name => `${connection.target || ''}`.toLowerCase().includes(name.toLowerCase()))).map(connection => connection.targetPin.toUpperCase());
    const channelPins = new Set([...ownPins, ...incomingPins].map(pin => pin.replace(/[\s_-]/g, '')));
    const channels = new Set([...channelPins].map(pin => pin.match(/^(?:HV|LV)(\d+)$/)?.[1]).filter((value): value is string => Boolean(value)));
    for (const channel of channels) if (!channelPins.has(`HV${channel}`) || !channelPins.has(`LV${channel}`)) issues.push(`${converter.name} 的通道 ${channel} 缺少成对的 HV${channel}/LV${channel} 接线`);
  }
  for (const connection of spec.connections) {
    const sourcePin = connection.sourcePin.trim();
    const targetPin = connection.targetPin.trim();
    const targetText = `${connection.target} ${targetPin}`;
    const selfTarget = spec.components.find(component => sameComponent(connection, component));
    const normalizedTarget = `${connection.target || ''}`.trim().toLowerCase().replace(/[\s_\-（）()]/g, '');
    const targetsOwnerExactly = Boolean(selfTarget && [selfTarget.name, selfTarget.model || '']
      .map(name => name.trim().toLowerCase().replace(/[\s_\-（）()]/g, ''))
      .filter(Boolean)
      .some(name => normalizedTarget === name));
    if (targetsOwnerExactly && /^(?:VCC|VIN|\+?5V|3\.3V|GND|GROUND|\+|-)$/i.test(sourcePin)) {
      issues.push(`${connection.componentName} 的 ${sourcePin} 不能接回元件自身，应连接真实电源或共地点`);
    }
    const targetIsPeripheral = spec.components.some(component =>
      component.role !== 'controller' && component.role !== 'power' &&
      component.name !== connection.componentName &&
      [component.name, component.model || ''].filter(Boolean).some(name => targetText.toLowerCase().includes(name.toLowerCase()))
    );
    if (targetIsPeripheral && !circuitIntermediary(`${connection.componentName} ${connection.target} ${sourcePin} ${targetPin}`)) issues.push(`${connection.componentName} 的 ${sourcePin} 不应直接接到另一个传感器或执行器 ${connection.target} ${targetPin}`);
    if (/^(?:VCC|\+)$/i.test(sourcePin) && !/^(?:\+?\d+(?:\.\d+)?V|\d+V\d+|VIN|VCC)$/i.test(targetPin) && !circuitIntermediary(`${connection.target} ${targetPin}`)) {
      issues.push(`${connection.componentName} 的 VCC 目标 ${connection.target} ${targetPin} 不是有效供电端`);
    }
    if (/^(?:GND|GROUND)$/i.test(sourcePin) && !/(?:GND|GROUND|共地|-)/i.test(targetText) && !circuitIntermediary(`${connection.target} ${targetPin}`)) {
      issues.push(`${connection.componentName} 的 GND 没有连接到地或共地点`);
    }
    if (/^(?:A\d+|D\d+)$/i.test(sourcePin) && sourcePin.toUpperCase() === targetPin.toUpperCase()) {
      issues.push(`${connection.componentName} 的模块端引脚被错误写成开发板引脚 ${sourcePin}，应填写 AO、DO、DIN、DATA 等真实端子名`);
    }
    if (connection.voltage && spec.board.voltage && /5V/i.test(connection.voltage) && /3\.3V/i.test(spec.board.voltage)) {
      issues.push(`${connection.componentName} 的 ${connection.sourcePin} 标注为 5V，与 ${spec.board.name} 的 3.3V 电平可能不兼容`);
    }
  }
  if (!spec.acceptance.length) issues.push('缺少验收标准');
  return [...new Set(issues)];
}

function connectionTargetsBoard(connection: ConnectionSpec, spec: ProjectSpec): boolean {
  const target = `${connection.target || ''}`.toLowerCase();
  const boardNames = [spec.board.name, 'arduino', '开发板', '主板'].map(value => value.toLowerCase()).filter(Boolean);
  return boardNames.some(name => target.includes(name)) && /^(?:A\d+|D?\d+|SDA|SCL|SCK|MOSI|MISO)$/i.test(connection.targetPin);
}

export function evaluateCodeAgainstSpec(code: string, spec: ProjectSpec): string[] {
  const issues: string[] = [];
  if (!/\bvoid\s+setup\s*\(/.test(code)) issues.push('缺少 setup()');
  if (!/\bvoid\s+loop\s*\(/.test(code)) issues.push('缺少 loop()');
  for (const connection of spec.connections.filter(connection => connectionTargetsBoard(connection, spec))) {
    if (/SPI\s*(?:SCK|MOSI|MISO)|spi-(?:sck|mosi|miso)/i.test(`${connection.signalType || ''} ${connection.sourcePin}`) && /#include\s*[<"]SPI\.h[>"]|\bSPI\s*\.|MFRC522/i.test(code)) continue;
    const pin = connection.targetPin.replace(/^D(?=\d+$)/i, '');
    if (/^(?:A\d+|\d+|LED_BUILTIN)$/i.test(pin) && !new RegExp(`(?:^|[^A-Z0-9_])(?:D)?${pin}(?:[^A-Z0-9_]|$)`, 'i').test(code)) {
      issues.push(`代码没有使用接线中的引脚 ${connection.targetPin}`);
    }
  }
  const normalizePin = (value: string): string => value.trim().toUpperCase().replace(/^D(?=\d+$)/, '');
  const allowedPins = new Set(spec.connections.filter(connection => connectionTargetsBoard(connection, spec)).map(connection => normalizePin(connection.targetPin)));
  // 板载LED属于开发板本体，不要求用户额外选择；经典AVR板通常为13。
  if (/arduino:avr:(?:uno|nano|mega|leonardo|micro)/i.test(spec.board.fqbn)) allowedPins.add('13');
  const declaredPins = new Map<string, string>();
  const declaration = /(?:#define\s+|(?:const\s+)?(?:static\s+)?(?:u?int(?:8|16|32)?_t|byte|int)\s+)([A-Za-z_]\w*)\s*(?:=\s*)?(A\d+|D?\d+)\b/gi;
  const pinSymbol = (name: string): boolean => /(?:^|_)PIN(?:_|$)/i.test(name) || /^(?:TRIG|ECHO|SDA|SCL|SCK|MOSI|MISO|SS|CS)$/i.test(name) || /(?:^|_)(?:TRIG|ECHO|SDA|SCL|SCK|MOSI|MISO|SS|CS)(?:_|$)/i.test(name);
  for (const match of code.matchAll(declaration)) if (pinSymbol(match[1])) declaredPins.set(match[1], normalizePin(match[2]));
  for (const [symbol, pin] of declaredPins) {
    if (!allowedPins.has(pin)) issues.push(`代码声明了接线表之外的引脚 ${symbol}=${matchBoardPinLabel(pin)}`);
  }
  const directPinCalls = /\b(?:pinMode|digitalRead|digitalWrite|analogRead|analogWrite|tone|noTone)\s*\(\s*(A\d+|D?\d+)\b/gi;
  for (const match of code.matchAll(directPinCalls)) {
    const pin = normalizePin(match[1]);
    if (!allowedPins.has(pin)) issues.push(`代码直接使用了接线表之外的引脚 ${matchBoardPinLabel(pin)}`);
  }
  return [...new Set(issues)];
}

function matchBoardPinLabel(pin: string): string {
  return /^A\d+$/i.test(pin) ? pin.toUpperCase() : `D${pin.replace(/^D/i, '')}`;
}
