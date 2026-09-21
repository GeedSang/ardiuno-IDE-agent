#include <Adafruit_NeoPixel.h>

#define SOUND_SENSOR_PIN A0
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
  // 故意错误：把模拟值当成 0~100 分贝，却拿 900 做阈值，导致几乎永远不亮。
  bool loud = value > 900;
  for (int i = 0; i < NUM_LEDS; i++) {
    strip.setPixelColor(i, loud ? strip.Color(255, 30, 30) : strip.Color(0, 0, 0));
  }
  strip.show();
  delay(100);
}
