const assert = require('node:assert/strict');
const { contractsFor, hardwareContracts, verifiedContractKnowledge } = require('../dist/hardwareContracts');

assert.ok(hardwareContracts.length >= 12);
assert.equal(new Set(hardwareContracts.map(item => item.id)).size, hardwareContracts.length);
for (const contract of hardwareContracts) {
  assert.ok(contract.signalPins.length, `${contract.id} needs signal pins`);
  assert.ok(contract.powerPins.length, `${contract.id} needs power pins`);
  assert.ok(contract.evidence.length, `${contract.id} needs provenance`);
  for (const evidence of contract.evidence) assert.match(evidence.url, /^https:\/\//, `${contract.id} evidence must be an HTTPS URL`);
}
assert.deepEqual(contractsFor('使用A4988控制步进电机').map(item => item.id), ['a4988']);
assert.deepEqual(contractsFor('MPU6050 GY-521读取姿态').map(item => item.id), ['mpu6050']);
assert.deepEqual(contractsFor('ADS1115采集模拟电压').map(item => item.id), ['ads1115']);
assert.deepEqual(contractsFor('HC-05蓝牙串口').map(item => item.id), ['hc05']);
const rfid = verifiedContractKnowledge('RC522刷卡开门');
assert.match(rfid, /已验证契约 mfrc522/);
assert.match(rfid, /3\.3V/);
assert.match(rfid, /nxp\.com/);
assert.equal(verifiedContractKnowledge('完全未知的XYZ传感器'), '');
console.log('hardware contract provenance tests passed');
