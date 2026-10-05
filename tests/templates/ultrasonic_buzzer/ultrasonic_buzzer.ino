#define TRIG_PIN 9
#define ECHO_PIN 10
#define BUZZER_PIN 6
const float ALARM_DISTANCE_CM = 20.0;

float readDistanceCm() {
  digitalWrite(TRIG_PIN, LOW); delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 30000UL);
  return duration == 0 ? -1.0 : duration * 0.0343 / 2.0;
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
}

void loop() {
  float distance = readDistanceCm();
  bool alarm = distance > 0 && distance <= ALARM_DISTANCE_CM;
  digitalWrite(BUZZER_PIN, alarm ? HIGH : LOW);
  Serial.println(distance);
  delay(60);
}
