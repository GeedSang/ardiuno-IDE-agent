const assert = require('node:assert/strict');
const { baselineBenchmarkCases, benchmarkCases, benchmarkSummary, createMutatedHoldoutCases, frozenHoldoutBenchmarkCases, unfamiliarBenchmarkCases } = require('../dist/benchmark');
assert.ok(benchmarkCases.length >= 32);
assert.equal(baselineBenchmarkCases.length, 12);
assert.equal(unfamiliarBenchmarkCases.length, 12);
assert.equal(frozenHoldoutBenchmarkCases.length, 8);
assert.equal(new Set(baselineBenchmarkCases.map(item => item.id)).size, 12);
assert.equal(new Set(unfamiliarBenchmarkCases.map(item => item.id)).size, 12);
assert.ok(unfamiliarBenchmarkCases.every(item => !baselineBenchmarkCases.some(base => base.id === item.id)));
const mutatedA = createMutatedHoldoutCases('fixed-seed', 6);
const mutatedB = createMutatedHoldoutCases('fixed-seed', 6);
assert.deepEqual(mutatedA, mutatedB, 'mutation seed must be reproducible');
assert.equal(mutatedA.length, 6);
assert.equal(new Set(mutatedA.map(item => item.id)).size, 6);
assert.ok(mutatedA.every(item => /arduino:avr:(?:uno|nano|mega)/.test(item.goal)));
assert.equal(new Set(benchmarkCases.map(item => item.id)).size, benchmarkCases.length);
assert.ok(new Set(benchmarkCases.map(item => item.family)).size >= 20);
const result = benchmarkSummary([
  { id: 'a', family: 'f', stage: 'passed', qualityPassed: true, compilePassed: true, firstCompilePassed: true, repaired: false, durationMs: 1 },
  { id: 'b', family: 'f', stage: 'passed', qualityPassed: true, compilePassed: true, firstCompilePassed: false, repaired: true, durationMs: 2 },
  { id: 'c', family: 'f', stage: 'compile', qualityPassed: true, compilePassed: false, firstCompilePassed: false, repaired: false, durationMs: 3 }
]);
assert.deepEqual(result, { total: 3, passed: 2, qualityPassed: 3, compilePassed: 2, firstCompilePassed: 1, repaired: 1, failures: { compile: 1 } });
console.log('benchmark corpus and metrics tests passed');
