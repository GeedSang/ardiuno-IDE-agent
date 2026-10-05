#include <Servo.h>
#define LEFT_LDR_PIN A0
#define RIGHT_LDR_PIN A1
#define SERVO_PIN 9

Servo trackerServo;
float leftFiltered = 0.0f;
float rightFiltered = 0.0f;
int servoAngle = 90;
const int DEAD_BAND = 35;
const int MIN_ANGLE = 10;
const int MAX_ANGLE = 170;
const int STEP_DEGREES = 1;
const bool SERVO_REVERSED = false;
unsigned long lastUpdate = 0;

void setup() {
  Serial.begin(115200);
  trackerServo.attach(SERVO_PIN);
  trackerServo.write(servoAngle);
  leftFiltered = analogRead(LEFT_LDR_PIN);
  rightFiltered = analogRead(RIGHT_LDR_PIN);
}

void loop() {
  unsigned long now = millis();
  if (now - lastUpdate < 40) return;
  lastUpdate = now;
  leftFiltered = leftFiltered * 0.75f + analogRead(LEFT_LDR_PIN) * 0.25f;
  rightFiltered = rightFiltered * 0.75f + analogRead(RIGHT_LDR_PIN) * 0.25f;
  int difference = (int)(leftFiltered - rightFiltered);
  if (abs(difference) > DEAD_BAND) {
    int direction = difference > 0 ? -1 : 1;
    if (SERVO_REVERSED) direction = -direction;
    servoAngle = constrain(servoAngle + direction * STEP_DEGREES, MIN_ANGLE, MAX_ANGLE);
    trackerServo.write(servoAngle);
  }
  Serial.print("left="); Serial.print(leftFiltered, 0);
  Serial.print(" right="); Serial.print(rightFiltered, 0);
  Serial.print(" difference="); Serial.print(difference);
  Serial.print(" angle="); Serial.println(servoAngle);
}
