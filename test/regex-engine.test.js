'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RegexEngine, parsePattern, ParseError } = require('../src/regex-engine.js');

test('literal concatenation', () => {
  const re = new RegexEngine('abc');
  assert.equal(re.test('abc'), true);
  assert.equal(re.test('abx'), false);
  assert.equal(re.test('ab'), false);
  assert.equal(re.test('abcd'), false);
});

test('alternation', () => {
  const re = new RegexEngine('cat|dog');
  assert.equal(re.test('cat'), true);
  assert.equal(re.test('dog'), true);
  assert.equal(re.test('cog'), false);
});

test('star allows zero or more repetitions', () => {
  const re = new RegexEngine('ab*c');
  assert.equal(re.test('ac'), true);
  assert.equal(re.test('abc'), true);
  assert.equal(re.test('abbbbbc'), true);
  assert.equal(re.test('abx'), false);
});

test('plus requires at least one repetition', () => {
  const re = new RegexEngine('ab+c');
  assert.equal(re.test('ac'), false);
  assert.equal(re.test('abc'), true);
  assert.equal(re.test('abbbc'), true);
});

test('optional matches zero or one', () => {
  const re = new RegexEngine('colou?r');
  assert.equal(re.test('color'), true);
  assert.equal(re.test('colour'), true);
  assert.equal(re.test('colouur'), false);
});

test('grouping with quantifiers', () => {
  const re = new RegexEngine('(ab)+');
  assert.equal(re.test('ab'), true);
  assert.equal(re.test('abab'), true);
  assert.equal(re.test('aba'), false);
});

test('any character', () => {
  const re = new RegexEngine('a.c');
  assert.equal(re.test('abc'), true);
  assert.equal(re.test('axc'), true);
  assert.equal(re.test('ac'), false);
});

test('character classes and ranges', () => {
  const re = new RegexEngine('[a-c]+[0-9]');
  assert.equal(re.test('abc5'), true);
  assert.equal(re.test('z5'), false);
  assert.equal(re.test('abc'), false);
});

test('negated character class', () => {
  const re = new RegexEngine('[^0-9]+');
  assert.equal(re.test('hello'), true);
  assert.equal(re.test('hell0'), false);
});

test('shorthand classes \\d \\w \\s', () => {
  assert.equal(new RegexEngine('\\d+').test('2026'), true);
  assert.equal(new RegexEngine('\\d+').test('20a6'), false);
  assert.equal(new RegexEngine('\\w+').test('a_b9'), true);
  assert.equal(new RegexEngine('a\\sb').test('a b'), true);
});

test('escaped metacharacters are literal', () => {
  const re = new RegexEngine('3\\.14');
  assert.equal(re.test('3.14'), true);
  assert.equal(re.test('3x14'), false);
});

test('anchors restrict matches to start/end of string', () => {
  const re = new RegexEngine('^abc$');
  assert.equal(re.test('abc'), true);
  const search = new RegexEngine('^abc');
  assert.equal(search.search('abc def').start, 0);
});

test('search finds the leftmost match inside a larger string', () => {
  const re = new RegexEngine('\\d+');
  const m = re.search('order #42 shipped on day 7');
  assert.deepEqual(m, { start: 7, end: 9, text: '42' });
});

test('search returns null when there is no match', () => {
  const re = new RegexEngine('[0-9]+');
  assert.equal(re.search('no digits here'), null);
});

test('findAll returns every non-overlapping match', () => {
  const re = new RegexEngine('[A-Za-z]+');
  const matches = new RegexEngine('[A-Za-z]+').findAll('Hello, World! Regex 101');
  assert.deepEqual(matches.map((m) => m.text), ['Hello', 'World', 'Regex']);
});

test('matching is leftmost-longest, not leftmost-first', () => {
  // A naive backtracker that tries 'a' before 'ab' as the first
  // alternative could stop early; Thompson simulation explores both
  // branches simultaneously and keeps the longest accepting one.
  const re = new RegexEngine('a|ab');
  assert.deepEqual(re.search('ab'), { start: 0, end: 2, text: 'ab' });
});

test('does not catastrophically backtrack on classically pathological patterns', () => {
  // A backtracking engine can take exponential time on (a+)+b against
  // a long run of a's with no trailing b. Thompson simulation is
  // linear in the input length regardless.
  const re = new RegexEngine('(a+)+b');
  const input = 'a'.repeat(2000);
  const start = Date.now();
  const result = re.test(input);
  const elapsed = Date.now() - start;
  assert.equal(result, false);
  assert.ok(elapsed < 500, `expected fast rejection, took ${elapsed}ms`);
});

test('invalid patterns raise a ParseError', () => {
  assert.throws(() => parsePattern('a('), ParseError);
  assert.throws(() => parsePattern('a)'), ParseError);
  assert.throws(() => parsePattern('*a'), ParseError);
  assert.throws(() => parsePattern('[a-'), ParseError);
});

test('empty pattern matches the empty string only', () => {
  const re = new RegexEngine('');
  assert.equal(re.test(''), true);
  assert.equal(re.test('x'), false);
});
