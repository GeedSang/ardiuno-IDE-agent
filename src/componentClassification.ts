export type ClassifiableComponent = {
  name: string;
  model?: string;
  interface?: string;
  role?: string;
};

export type ComponentConnectionClass = 'electrical' | 'wiring-accessory' | 'mechanical-accessory' | 'unknown';

export const COMPONENT_CLASSIFICATION_EXAMPLES = {
  electrical: ['Arduino/ESP开发板', '各类传感器', '按钮/键盘/摇杆', '编码器/电位器', '继电器/MOSFET驱动', '舵机/直流电机/步进电机', '水泵/电磁阀/风扇', 'LED/灯带/数码管', 'OLED/LCD显示屏', '蜂鸣器/扬声器/麦克风', '蓝牙/Wi-Fi/GPS/RFID', '摄像头/SD卡/RTC', '电源模块/电池盒/稳压器', '电阻/电容/二极管/三极管/芯片'],
  wiringAccessory: ['杜邦线', '跳线', 'USB数据线', '电源线', '鳄鱼夹线', '排线', '面包板', '洞洞板', '排针/插针', '接插件/端子台', '线束/延长线/转接线'],
  mechanicalAccessory: ['外壳/控制箱/防水盒', '隔水板/挡板/亚克力板', '安装板/底板/导轨', '支架/底座/固定架', '螺丝/螺母/垫片/卡扣', '扎带/热缩管/线槽', '胶带/胶水/密封圈', '水箱/储水桶/花盆/托盘', '水管/软管/滴灌管/接头', '过滤棉/海绵', '标签/包装', '螺丝刀/烙铁/万用表']
} as const;

const explicitElectricalRole = /^(?:input|output|controller|power)$/i;
const electricalInterfacePattern = /模拟|数字|GPIO|PWM|I2C|SPI|UART|串口|OneWire|单总线|VCC|GND|电源|信号|data|analog|digital|input|output/i;
const wiringAccessoryPattern = /杜邦(?:线|连接线)?|跳线|jumper\s*wire|连接线套装|USB\s*(?:数据)?线|电源线|DC\s*(?:插头)?线|鳄鱼夹线|排线|彩排线|线束|延长线|转接线|面包板|breadboard|洞洞板|万用板|实验板|排针|插针|接插件|端子台|接线端子|香蕉插头|航空插头/i;
const explicitMechanicalObjectPattern = /外壳|机壳|壳体|保护(?:壳|盒|罩)|控制箱|接线箱|防水(?:盒|箱|壳|罩)|隔水板|挡水板|隔板|挡板|安装板|底板|支架|固定架|安装架|底座|卡扣|夹具/i;
const electricalPattern = /传感器|sensor|探头|probe|模块|module|开发板|控制板|arduino|raspberry|树莓派|esp(?:32|8266)|stm32|单片机|电源模块|稳压|降压|升压|转换器|适配器|battery|电池(?:盒|座|组)?|太阳能板|保险丝|电机|motor|水泵|pump|舵机|servo|步进|stepper|电磁阀|solenoid|风扇|fan|加热|heater|雾化|灯(?:带|珠|板)?|\bLED\b|WS2812|NeoPixel|数码管|点阵|显示|OLED|LCD|蜂鸣器|buzzer|继电器|relay|MOSFET|按钮|按键|button|键盘|keypad|开关|switch|编码器|encoder|电位器|potentiometer|摇杆|joystick|芯片|\bIC\b|驱动器|driver|摄像头|camera|麦克风|microphone|喇叭|speaker|扬声器|GPS|蓝牙|bluetooth|Wi-?Fi|RFID|NFC|红外(?:发射|接收)|IR\s*(?:receiver|transmitter)|无线|LoRa|NRF24|SD卡|存储|RTC|时钟|电阻|resistor|电容|capacitor|二极管|diode|三极管|transistor|光耦|晶振|inductor|电感|热电偶|称重|HX711|压力|流量计|霍尔|震动|倾斜|雨滴|土壤|气体|烟雾/i;
const mechanicalAccessoryPattern = /外壳|机壳|壳体|保护壳|控制箱|接线箱|防水(?:盒|箱|壳|罩)|隔水板|挡水板|隔板|挡板|亚克力板|木板|纸板|泡沫板|安装板|底板|导轨|支架|固定架|底座|卡扣|夹具|螺丝|螺钉|螺栓|螺母|垫片|铜柱|扎带|热缩管|编织套管|线槽|胶带|双面胶|热熔胶|胶水|密封圈|密封胶|花盆|种植盆|水箱|储水桶|水桶|容器|托盘|水管|软管|滴灌管|硅胶管|管接头|三通|弯头|喷头|滴头|过滤棉|过滤网|海绵|标签|包装|螺丝刀|电烙铁|烙铁架|万用表|剥线钳|剪线钳/i;

export function classifyComponentConnection(component: ClassifiableComponent): { kind: ComponentConnectionClass; reason: string } {
  const role = component.role || '';
  const text = `${component.name || ''} ${component.model || ''} ${component.interface || ''}`;
  if (wiringAccessoryPattern.test(text)) return { kind: 'wiring-accessory', reason: '属于导线、接插件或搭建载体，不作为独立模块分配端子' };
  if (explicitMechanicalObjectPattern.test(text)) return { kind: 'mechanical-accessory', reason: '名称明确指向外壳、安装件或结构件' };
  if (electricalPattern.test(text)) return { kind: 'electrical', reason: '名称或型号表明它具有电气功能' };
  if (mechanicalAccessoryPattern.test(text)) return { kind: 'mechanical-accessory', reason: '属于结构、防护、流体或安装辅材' };
  if (explicitElectricalRole.test(role)) return { kind: 'electrical', reason: `角色为 ${role}` };
  if (electricalInterfacePattern.test(component.interface || '')) return { kind: 'electrical', reason: `接口“${component.interface}”属于电气接口` };
  if (role === 'other' && /无源|机械|结构|装配|固定|防护|容器|耗材|辅材|不接线|无需接线|non-?electrical|mechanical/i.test(component.interface || '')) return { kind: 'mechanical-accessory', reason: '方案已明确标记为无需接线的辅材' };
  return { kind: 'unknown', reason: '名称、角色和接口不足以安全判断' };
}

export function isNonElectricalAccessory(component: ClassifiableComponent): boolean {
  const kind = classifyComponentConnection(component).kind;
  return kind === 'wiring-accessory' || kind === 'mechanical-accessory';
}
