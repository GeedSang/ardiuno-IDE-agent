#include <Servo.h>
#define SERVO_PIN 9
#define CONTROL_PIN A0
Servo motor;

void setup() {
  Serial.begin(115200);
  motor.attach(SERVO_PIN);
  motor.write(90);
}

void loop() {
  int raw = analogRead(CONTROL_PIN);
  int angle = map(raw, 0, 1023, 0, 180);
  motor.write(angle);
  Serial.println(angle);
  delay(20);
}
