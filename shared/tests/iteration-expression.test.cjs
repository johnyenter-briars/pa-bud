const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../src/iteration-expression.js');
const { compile } = globalThis.__paIterationExpression;

test('finds the requested item at zero-based index 2', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];
  assert.deepEqual(items.map((item, i) => compile("item()['id'] == 3")(item, i)), [false, false, true]);
});
test('nested properties, missing fields, and compound predicates', () => {
  const match = compile("item().customer?.name == 'Sam' && (item()['amount'] >= 3 || index() == 0)");
  assert.equal(match({ customer: { name: 'Sam' }, amount: 4 }, 2), true);
  assert.equal(match({}, 2), false);
  assert.equal(compile("item()?['missing'] == null")({}, 0), true);
});
test('arrays and primitive loop items', () => {
  assert.equal(compile("item()[1].id === 3")([null, { id: 3 }], 0), true);
  assert.equal(compile('item() == 3')(3, 0), true);
  assert.equal(compile("contains(item(), 'ab')")('abc', 0), true);
});
test('functions and Power Automate-style equals', () => {
  assert.equal(compile("@equals(item()?['id'], 3)")({ id: 3 }, 0), true);
  assert.equal(compile("!empty(item().tags) && contains(item().tags, 'red')")({ tags: ['red'] }, 0), true);
  assert.equal(compile("startsWith(toLower(item().name), 'sam') && length(item().name) > 2")({ name: 'SAM' }, 0), true);
});
test('preserves coercing versus strict comparisons', () => {
  assert.equal(compile('item() == 3')('3'), true);
  assert.equal(compile('item() === 3')('3'), false);
});
test('string escaping and signed numbers', () => {
  assert.equal(compile("item() == 'can\\'t'")("can't"), true);
  assert.equal(compile('item() < -2.5')(-3), true);
});
test('rejects executable code and prototype access', () => {
  for (const source of ['fetch("https://example.com")', 'window.location', 'item().constructor',
    'item()["__proto__"]', 'item().id = 3', 'item().toString()', 'item(); alert(1)',
    'item()[item().key]', 'item() => true', '']) {
    assert.throws(() => compile(source), undefined, source);
  }
});
test('rejects overly deep or long expressions', () => {
  assert.throws(() => compile('('.repeat(40) + 'true' + ')'.repeat(40)));
  assert.throws(() => compile('x'.repeat(2001)));
});
