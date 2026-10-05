#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#define DHT_PIN 2
#define DHT_TYPE DHT11
DHT dht(DHT_PIN, DHT_TYPE);
Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  Serial.begin(115200);
  dht.begin();
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) while (true) {}
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  if (!isnan(humidity) && !isnan(temperature)) {
    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 8);
    display.print(temperature, 1);
    display.println(" C");
    display.print(humidity, 1);
    display.println(" %");
    display.display();
  }
  delay(2000);
}
