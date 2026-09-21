#include <Adafruit_NeoPixel.h>

// 故意错误：实物接在 A0，但代码读取 A1。
#define SOUND_SENSOR_PIN A1
#define LED_PIN 5
#define NUM_LEDS 8
Adafruit_NeoPixel strip(NUM_LEDS, LED_PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  Serial.begin(115200);
  strip.begin();
  strip.setBrightness(80);
  strip.show();
}

void loop() {
  int value = analogRead(SOUND_SENSOR_PIN);
  Serial.println(value);
  uint32_t color = value > 500 ? strip.Color(255, 20, 20) : strip.Color(0, 0, 30);
  for (int i = 0; i < NUM_LEDS; i++) strip.setPixelColor(i, color);
  strip.show();
  delay(100);
}
