"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.frozenHoldoutBenchmarkCases = exports.unfamiliarBenchmarkCases = exports.baselineBenchmarkCases = exports.benchmarkCases = void 0;
exports.createMutatedHoldoutCases = createMutatedHoldoutCases;
exports.benchmarkSummary = benchmarkSummary;
/** Regression and challenge requirements, deliberately not tied to code templates. */
exports.benchmarkCases = [
    { id: 'garden-alert', family: '农业控制', goal: '用土壤湿度传感器检测花盆，干燥时驱动小水泵浇水，水泵必须使用独立电源和驱动电路，避免频繁开关。' },
    { id: 'room-climate', family: '显示与环境', goal: 'DHT22测量温度和湿度，每两秒更新I2C OLED；读数异常时保留上一次有效值，并在串口报告。' },
    { id: 'distance-alarm', family: '测距', goal: 'HC-SR04测距，小于20厘米时蜂鸣器报警，同时串口打印距离；没有回波时不能误报警。' },
    { id: 'sun-tracker', family: '运动控制', goal: '两个光敏传感器检测左右光线，舵机缓慢追向更亮的一边，加入死区防止不停抖动。' },
    { id: 'access-rfid', family: '门禁', goal: '用RC522读取卡号，授权卡触发舵机开门3秒，未授权卡亮红色LED；用按钮在内部打开。' },
    { id: 'water-level', family: '水位', goal: '水位传感器检测低水位，OLED显示状态，低水位连续五秒后让蜂鸣器提醒，恢复后停止。' },
    { id: 'gas-ventilation', family: '安全', goal: 'MQ-2气体传感器连续采样，超过可调阈值时用继电器启动外部供电风扇，配合蜂鸣器报警。' },
    { id: 'color-sorter', family: '多传感器机械', goal: '超声波检测到物体后，TCS34725识别红绿蓝；四个舵机驱动机械臂把物体移到对应盒子，按钮用于急停。' },
    { id: 'sound-flow', family: '可编程灯光', goal: '模拟声音传感器控制80颗WS2812灯带，安静时蓝色、越响越偏粉色，颜色沿灯带逐灯滚动，避免闪烁。' },
    { id: 'line-follower', family: '移动机器人', goal: '两个循迹传感器分别检测左右黑线，用L298N控制两台直流电机调整方向，失去线时停车。' },
    { id: 'gesture-lamp', family: '手势与灯光', goal: 'APDS9960识别左右挥动手势，控制WS2812灯带颜色切换；按钮可一键关灯。' },
    { id: 'weather-station', family: '多总线监测', goal: 'BME280采集温湿度气压，BH1750采集光照，两者共享I2C总线，OLED周期展示并通过串口输出数据。' },
    { id: 'rotary-menu', family: '人机交互', goal: '旋转编码器的CLK、DT和按键控制OLED菜单，旋转调整阈值，按下确认；使用内部上拉且不添加多余外部电阻。' },
    { id: 'stepper-position', family: '步进运动', goal: 'A4988驱动NEMA17步进电机，使用STEP/DIR和可选EN，两个限位开关作为安全停止，电机电源与逻辑电源分开共地。' },
    { id: 'load-scale', family: '称重测量', goal: 'HX711读取四线称重传感器，滤波并提供去皮按钮，OLED显示克数；传感器不能直接接Arduino模拟口。' },
    { id: 'rtc-relay', family: '定时控制', goal: 'DS3231实时时钟每天指定时段控制继电器，OLED显示时间和继电器状态，断电后时间仍保持。' },
    { id: 'gps-log', family: '串口定位', goal: 'NEO-6M GPS通过软件串口读取经纬度，解析有效定位后写入串口；避开Uno硬件串口D0/D1并处理无定位状态。' },
    { id: 'sd-logger', family: '数据记录', goal: '模拟温度传感器采样后写入MicroSD卡CSV文件，每分钟追加一行；SD使用SPI并独占CS，初始化失败要提示。' },
    { id: 'matrix-keypad', family: '矩阵输入', goal: '4x4薄膜矩阵键盘输入密码，正确时驱动蜂鸣器和继电器，错误次数过多暂时锁定；键盘无源触点不虚构VCC。' },
    { id: 'max7219-display', family: '点阵显示', goal: 'MAX7219 8x8点阵显示滚动文字，使用真实SPI类库和DIN/CLK/CS接线，不把点阵当WS2812。' },
    { id: 'dual-bus', family: '混合总线', goal: 'MPU6050和BH1750共享I2C，同时用串口蓝牙模块发送数据；处理固定I2C地址和TX/RX交叉连接。' },
    { id: 'waterproof-temp', family: '单总线传感', goal: '防水DS18B20测温并在OLED显示，使用OneWire和DallasTemperature，配置4.7k上拉，传感器断线显示错误。' },
    { id: 'mosfet-strip', family: '功率驱动', goal: 'Arduino PWM通过逻辑电平MOSFET调节12V灯带亮度，外部电源供电、共地并保留栅极电阻，不让灯带直接接IO。' },
    { id: 'joystick-servo', family: '模拟控制', goal: '双轴摇杆VRX/VRY控制两个舵机，SW按键切换模式；舵机使用独立5V供电并与Arduino共地。' },
    { id: 'holdout-incubator', family: '冻结盲测·环境执行', goal: 'SHT31监测培养箱温湿度，温度过低时经MOSFET控制外部加热片，过高时启动风扇；OLED显示状态并设置迟滞，两个负载都不能直接接IO。' },
    { id: 'holdout-parking', family: '冻结盲测·计数显示', goal: '入口和出口各用一个红外对射传感器统计停车位占用，TM1637四位数码管显示剩余数量，按键长按清零并保存到EEPROM。' },
    { id: 'holdout-pulse', family: '冻结盲测·生理监测', goal: 'MAX30102采集心率与血氧原始数据，在I2C OLED显示波形和状态；传感器未接触或读数无效时不能显示虚假数值。' },
    { id: 'holdout-pn532-lock', family: '冻结盲测·门锁驱动', goal: 'PN532使用I2C读取NFC卡，授权后通过MOSFET和续流二极管驱动12V电磁锁2秒，内部按钮可开门，断电时保持安全状态。' },
    { id: 'holdout-energy', family: '冻结盲测·电源监测', goal: 'INA219测量直流负载电压和电流，OLED显示功率，超过限值连续3秒后断开继电器，并要求按钮确认后才能恢复。' },
    { id: 'holdout-greenhouse', family: '冻结盲测·多区灌溉', goal: '三个电容式土壤湿度传感器分别控制三路外部供电水泵，每路使用独立MOSFET低边驱动和续流保护，轮流浇水避免同时启动。' },
    { id: 'holdout-arm-record', family: '冻结盲测·示教机械臂', goal: '四个电位器示教四个舵机角度，按下记录键保存当前姿态到EEPROM，播放键按顺序平滑复现多个姿态；舵机独立供电并共地。' },
    { id: 'holdout-frequency', family: '冻结盲测·频率测量', goal: '霍尔传感器测量转速，使用中断统计脉冲并每秒更新I2C LCD；长时间没有脉冲时显示0，按钮切换每转脉冲数。' }
];
exports.baselineBenchmarkCases = exports.benchmarkCases.slice(0, 12);
exports.unfamiliarBenchmarkCases = exports.benchmarkCases.slice(12, 24);
exports.frozenHoldoutBenchmarkCases = exports.benchmarkCases.slice(24);
const hashText = (value) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++)
        hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
    return hash >>> 0;
};
function createMutatedHoldoutCases(seed, count = 6) {
    const boards = [
        '开发板固定使用 Arduino Uno（arduino:avr:uno）。',
        '开发板固定使用 Arduino Nano（arduino:avr:nano）。',
        '开发板固定使用 Arduino Mega 2560（arduino:avr:mega）。'
    ];
    const wrappers = [
        (goal) => `我是初学者，想做这个效果：${goal}`,
        (goal) => `请先按效果理解，不要增加无关硬件。${goal}`,
        (goal) => `项目描述可能不专业：${goal}`
    ];
    const ordered = [...exports.frozenHoldoutBenchmarkCases].sort((left, right) => hashText(`${seed}:${left.id}`) - hashText(`${seed}:${right.id}`));
    return ordered.slice(0, Math.max(1, Math.min(count, ordered.length))).map((item, index) => {
        const value = hashText(`${seed}:${item.id}:variant`);
        const wording = item.goal.replace(/按钮/g, value % 2 ? '按键' : '按钮').replace(/传感器/g, value % 3 ? '传感模块' : '传感器').replace(/OLED/g, value % 2 ? 'OLED屏' : 'OLED');
        return { id: `mut-${seed.slice(0, 6)}-${item.id.replace(/^holdout-/, '')}`, family: `随机变异·${item.family.replace(/^冻结盲测·/, '')}`, goal: `${boards[value % boards.length]}${wrappers[(value + index) % wrappers.length](wording)}` };
    });
}
function benchmarkSummary(results) {
    const failures = {};
    for (const result of results)
        if (result.stage !== 'passed')
            failures[result.stage] = (failures[result.stage] || 0) + 1;
    return {
        total: results.length,
        passed: results.filter(result => result.stage === 'passed').length,
        qualityPassed: results.filter(result => result.qualityPassed).length,
        compilePassed: results.filter(result => result.compilePassed).length,
        firstCompilePassed: results.filter(result => result.firstCompilePassed).length,
        repaired: results.filter(result => result.stage === 'passed' && result.repaired).length,
        failures
    };
}
//# sourceMappingURL=benchmark.js.map