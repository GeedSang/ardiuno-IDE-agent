const assert = require('assert');
const { parseModelJson } = require('../dist/modelJson');

assert.deepStrictEqual(parseModelJson('```json\n{"items":[{"id":1} {"id":2}]}\n```'), { items: [{ id: 1 }, { id: 2 }] });
assert.deepStrictEqual(parseModelJson('{"name":"sensor" "count":2}'), { name: 'sensor', count: 2 });
assert.deepStrictEqual(parseModelJson('{"items":[1,2,],}'), { items: [1, 2] });
assert.deepStrictEqual(parseModelJson('说明：{"items":[1,2]'), { items: [1, 2] });

console.log('model JSON repair tests passed');
