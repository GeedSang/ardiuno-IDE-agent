#include <Adafruit_NeoPixel.h>

// 定义引脚
#define SOUND_SENSOR_PIN A0    // 声音传感器连接到A0
#define LED_PIN 5              // LED灯带数据引脚连接到数字引脚6
#define NUM_LEDS 80            // LED灯带上的LED数量

// 创建NeoPixel对象
Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

// 声音参数 - 调整流动速度
#define MAX_DB 80.0            // 最大分贝值
#define MIN_DB 0.0             // 最小分贝值
#define FLOW_SPEED 60          // 稍微调慢：从40ms调整到60ms
#define FADE_RATE 0.94         // 稍微降低衰减让过渡更平滑
#define MIN_BRIGHTNESS 0.30    // 基础亮度
#define PULSE_SIZE 3           // 脉冲灯珠数量

// 颜色阈值
#define DB_BLUE 10              // 黄色阈值
#define DB_YELLOW 25           // 淡绿色阈值
#define DB_ORANGE 45           // 粉色阈值  
#define DB_RED 65              // 深粉色阈值

// 全局变量
int sensorValue = 0;
float currentDb = 0;
float smoothedDb = 0;
int flowOffset = 0;
unsigned long lastFlowUpdate = 0;

uint32_t currentColor;
uint32_t ledColors[NUM_LEDS];
float ledBrightness[NUM_LEDS];

// 传感器读取优化
unsigned long lastSensorUpdate = 0;
#define SENSOR_UPDATE_INTERVAL 20  // 稍微增加到20ms

void setup() {
  Serial.begin(115200);
  
  // 初始化LED灯带
  strip.begin();
  strip.show();
  strip.setBrightness(240);
  
  // 初始化数组
  for (int i = 0; i < NUM_LEDS; i++) {
    ledColors[i] = strip.Color(255, 255, 0);  // 初始黄色
    ledBrightness[i] = MIN_BRIGHTNESS;
  }
  
  Serial.println("调优速度拾音灯系统已启动");
}

void loop() {
  // 定时读取传感器 - 稍微降低频率减少CPU占用
  if (millis() - lastSensorUpdate >= SENSOR_UPDATE_INTERVAL) {
    readSoundLevel();
    updateColorFromDB();
    lastSensorUpdate = millis();
  }
  
  // 更新整体流动效果
  updateFlowEffect();
  
  // 更新LED显示
  updateLEDDisplay();
  
  // 增加一点点延时让整体节奏更舒适
  delayMicroseconds(800); // 0.8ms
}

// 读取声音传感器
void readSoundLevel() {
  sensorValue = analogRead(SOUND_SENSOR_PIN);
  currentDb = map(sensorValue, 0, 1023, 0, 100);
  
  // 保持较高的敏感度但响应稍缓和
  smoothedDb = smoothedDb * 0.82 + currentDb * 0.18;
  currentDb = constrain(smoothedDb, MIN_DB, MAX_DB);
  
  static unsigned long lastPrint = 0;
  if (millis() - lastPrint > 800) { // 稍微延长到800ms
    Serial.print("dB:");
    Serial.print(currentDb, 0);
    Serial.print(" | 颜色:0x");
    Serial.println(currentColor, HEX);
    lastPrint = millis();
  }
}

// 保持敏锐的颜色计算
void updateColorFromDB() {
  if (currentDb < DB_BLUE) {
    currentColor = strip.Color(0, 0, 255); // 黄色
  }
  else if (currentDb < DB_YELLOW) {
    float ratio = (currentDb - DB_BLUE) / (float)(DB_YELLOW - DB_BLUE);
    uint8_t r = 0 + ratio * 144;      // R: 255→144
    uint8_t g = 0 + ratio * 238;       // G: 255→238
    uint8_t b = 255 - ratio * 111;            // B: 0→144
    currentColor = strip.Color(r, g, b);
  }
  else if (currentDb < DB_ORANGE) {
    float ratio = (currentDb - DB_YELLOW) / (float)(DB_ORANGE - DB_YELLOW);
    uint8_t r = 144 + ratio * 111;      // R: 144→255
    uint8_t g = 238 - ratio * 46;       // G: 238→192
    uint8_t b = 144 + ratio * 59;       // B: 144→203
    currentColor = strip.Color(r, g, b);
  }
  else if (currentDb < DB_RED) {
    float ratio = (currentDb - DB_ORANGE) / (float)(DB_RED - DB_ORANGE);
    uint8_t r = 255;                    // R保持255
    uint8_t g = 192 - ratio * 142;      // G: 192→50
    uint8_t b = 203 + ratio * 52;       // B: 203→255
    currentColor = strip.Color(r, g, b);
  }
  else {
    currentColor = strip.Color(255, 50, 255); // 深粉色
  }
}

// 主要的流动效果 - 稍微调慢速度
void updateFlowEffect() {
  unsigned long currentTime = millis();
  
  if (currentTime - lastFlowUpdate >= FLOW_SPEED) { // 从40ms调整到60ms
    // 颜色向前流动
    for (int i = NUM_LEDS - 1; i > 0; i--) {
      ledColors[i] = ledColors[i-1];
      ledBrightness[i] = ledBrightness[i-1] * FADE_RATE; // 稍微慢一点的衰减
    }
    
    // 头部注入新颜色
    ledColors[0] = currentColor;
    ledBrightness[0] = 0.75 + (currentDb / MAX_DB) * 0.25; // 稍微降低新颜色亮度
    
    // 确保最低亮度
    for (int i = 0; i < NUM_LEDS; i++) {
      if (ledBrightness[i] < MIN_BRIGHTNESS) {
        ledBrightness[i] = MIN_BRIGHTNESS;
      }
    }
    
    lastFlowUpdate = currentTime;
  }
}

// 更新LED显示
void updateLEDDisplay() {
  for (int i = 0; i < NUM_LEDS; i++) {
    uint32_t color = ledColors[i];
    float brightness = ledBrightness[i];
    
    uint8_t r = ((color >> 16) & 0xFF) * brightness;
    uint8_t g = ((color >> 8) & 0xFF) * brightness;
    uint8_t b = (color & 0xFF) * brightness;
    
    strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
}