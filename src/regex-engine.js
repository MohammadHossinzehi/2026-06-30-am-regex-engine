/**
 * regex-engine.js
 *
 * A small regular expression engine built from scratch: no use of the
 * native RegExp object anywhere in the matching path. It works in three
 * stages, mirroring how real regex engines are built:
 *
 *   1. Parse    - recursive-descent parser turns the pattern string into
 *                 an abstract syntax tree (AST).
 *   2. Compile  - Thompson's construction turns the AST into an NFA
 *                 (nondeterministic finite automaton) made of states
 *                 connected by character and epsilon transitions.
 *   3. Simulate - the NFA is run breadth-first, tracking the *set* of
 *                 states the engine could be in after each input
 *                 character (Thompson's / Pike's algorithm). Because we
 *                 track a set of states instead of trying one branch at
 *                 a time and backtracking, matching is O(n * m) in the
 *                 length of the input and pattern, with no possibility
 *                 of the catastrophic backtracking that plagues naive
 *                 backtracking engines on patterns like (a+)+b.
 *
 * Supported syntax:
 *   literals        a, b, 5, ...
 *   any character   .
 *   concatenation   ab
 *   alternation     a|b
 *   star            a*
 *   plus            a+
 *   optional        a?
 *   grouping        (ab|c)
 *   character class [abc], [^abc], [a-z0-9]
 *   shorthand class \d \D \w \W \s \S
 *   escaped literal \. \* \\ \( etc.
 *   anchors         ^ $
 */

'use strict';

// ---------------------------------------------------------------------
// 1. Parser: pattern string -> AST
// ---------------------------------------------------------------------

class ParseError extends Error {}

function parsePattern(pattern) {
  const parser = new Parser(pattern);
  const ast = parser.parseAlternation();
  if (parser.pos !== pattern.length) {
    throw new ParseError(
      `Unexpected character '${parser.peek()}' at position ${parser.pos}`
    );
  }
  return ast;
}

class Parser {
  constructor(pattern) {
    this.pattern = pattern;
    this.pos = 0;
  }

  peek() {
    return this.pattern[this.pos];
  }

  next() {
    return this.pattern[this.pos++];
  }

  eof() {
    return this.pos >= this.pattern.length;
  }

  // alternation := concat ('|' concat)*
  parseAlternation() {
    const options = [this.parseConcat()];
    while (!this.eof() && this.peek() === '|') {
      this.next(); // consume '|'
      options.push(this.parseConcat());
    }
    return options.length === 1 ? options[0] : { type: 'alt', options };
  }

  // concat := quantified*
  parseConcat() {
    const parts = [];
    while (!this.eof() && this.peek() !== '|' && this.peek() !== ')') {
      parts.push(this.parseQuantified());
    }
    if (parts.length === 0) return { type: 'empty' };
    return parts.length === 1 ? parts[0] : { type: 'concat', parts };
  }

  // quantified := atom ('*' | '+' | '?')?
  parseQuantified() {
    let atom = this.parseAtom();
    if (!this.eof()) {
      const c = this.peek();
      if (c === '*') {
        this.next();
        atom = { type: 'star', child: atom };
      } else if (c === '+') {
        this.next();
        atom = { type: 'plus', child: atom };
      } else if (c === '?') {
        this.next();
        atom = { type: 'opt', child: atom };
      }
    }
    return atom;
  }

  // atom := '(' alternation ')' | '[' class ']' | '.' | '^' | '$' | escape | literal
  parseAtom() {
    if (this.eof()) {
      throw new ParseError('Unexpected end of pattern');
    }
    const c = this.next();

    if (c === '(') {
      const inner = this.parseAlternation();
      if (this.eof() || this.next() !== ')') {
        throw new ParseError('Missing closing )');
      }
      return { type: 'group', child: inner };
    }

    if (c === '[') {
      return this.parseClass();
    }

    if (c === '.') {
      return { type: 'any' };
    }

    if (c === '^') {
      return { type: 'startAnchor' };
    }

    if (c === '$') {
      return { type: 'endAnchor' };
    }

    if (c === '\\') {
      if (this.eof()) throw new ParseError('Dangling escape at end of pattern');
      return this.parseEscape(this.next());
    }

    if (c === '*' || c === '+' || c === '?') {
      throw new ParseError(`Quantifier '${c}' with nothing to repeat`);
    }

    return { type: 'char', value: c };
  }

  parseEscape(c) {
    switch (c) {
      case 'd':
        return { type: 'class', negate: false, ranges: [['0', '9']] };
      case 'D':
        return { type: 'class', negate: true, ranges: [['0', '9']] };
      case 'w':
        return {
          type: 'class',
          negate: false,
          ranges: [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']],
        };
      case 'W':
        return {
          type: 'class',
          negate: true,
          ranges: [['a', 'z'], ['A', 'Z'], ['0', '9'], ['_', '_']],
        };
      case 's':
        return {
          type: 'class',
          negate: false,
          ranges: [[' ', ' '], ['\t', '\t'], ['\n', '\n'], ['\r', '\r'], ['\f', '\f'], ['\v', '\v']],
        };
      case 'S':
        return {
          type: 'class',
          negate: true,
          ranges: [[' ', ' '], ['\t', '\t'], ['\n', '\n'], ['\r', '\r'], ['\f', '\f'], ['\v', '\v']],
        };
      case 'n':
        return { type: 'char', value: '\n' };
      case 't':
        return { type: 'char', value: '\t' };
      case 'r':
        return { type: 'char', value: '\r' };
      default:
        // Escaped metacharacter or literal backslash-escaped char.
        return { type: 'char', value: c };
    }
  }

  parseClass() {
    let negate = false;
    if (this.peek() === '^') {
      negate = true;
      this.next();
    }
    const ranges = [];
    let first = true;
    while (!this.eof() && (this.peek() !== ']' || first)) {
      first = false;
      let c = this.next();
      if (c === '\\') {
        if (this.eof()) throw new ParseError('Dangling escape in character class');
        const esc = this.parseEscape(this.next());
        if (esc.type === 'class') {
          // Shorthand class inside [...] - splice in its ranges.
          for (const r of esc.ranges) {
            if (esc.negate) {
              throw new ParseError('Negated shorthand classes are not supported inside [...]');
            }
            ranges.push(r);
          }
          continue;
        }
        c = esc.value;
      }
      if (this.peek() === '-' && this.pattern[this.pos + 1] !== ']' && this.pos + 1 < this.pattern.length) {
        this.next(); // consume '-'
        let end = this.next();
        if (end === '\\') {
          end = this.parseEscape(this.next()).value;
        }
        ranges.push([c, end]);
      } else {
        ranges.push([c, c]);
      }
    }
    if (this.eof() || this.next() !== ']') {
      throw new ParseError('Missing closing ]');
    }
    return { type: 'class', negate, ranges };
  }
}

// ---------------------------------------------------------------------
// 2. Compiler: AST -> NFA (Thompson's construction)
// ---------------------------------------------------------------------
//
// Each NFA is a flat array of states. A state has a list of outgoing
// transitions. A transition is either:
//   { eps: true, to }                          - free epsilon move
//   { match: fn, to }                           - consumes one char if fn(ch)
//   { anchor: 'start' | 'end', to }              - epsilon move, but only
//                                                   legal at the matching
//                                                   position in the input
//
// Construction uses the classic "fragment with dangling outputs" trick:
// build a fragment for each AST node with a single entry state and a
// list of (state, transition-index) pairs still pointing at -1, then
// patch them to the next fragment's entry state when concatenating.

class NFA {
  constructor() {
    this.states = [];
  }

  addState() {
    this.states.push({ transitions: [] });
    return this.states.length - 1;
  }

  addTransition(from, transition) {
    this.states[from].transitions.push(transition);
    return transition;
  }
}

function compile(ast) {
  const nfa = new NFA();
  const frag = build(ast, nfa);
  const acceptState = nfa.addState();
  patch(frag.out, acceptState);
  return { nfa, start: frag.start, accept: acceptState };
}

function patch(outList, target) {
  for (const t of outList) {
    t.to = target;
  }
}

function build(node, nfa) {
  switch (node.type) {
    case 'empty': {
      const s = nfa.addState();
      const t = nfa.addTransition(s, { eps: true, to: -1 });
      return { start: s, out: [t] };
    }

    case 'char': {
      const s = nfa.addState();
      const value = node.value;
      const t = nfa.addTransition(s, { match: (ch) => ch === value, to: -1 });
      return { start: s, out: [t] };
    }

    case 'any': {
      const s = nfa.addState();
      const t = nfa.addTransition(s, { match: (ch) => ch !== undefined, to: -1 });
      return { start: s, out: [t] };
    }

    case 'class': {
      const s = nfa.addState();
      const { ranges, negate } = node;
      const test = (ch) => {
        if (ch === undefined) return false;
        let inRange = false;
        for (const [lo, hi] of ranges) {
          if (ch >= lo && ch <= hi) {
            inRange = true;
            break;
          }
        }
        return negate ? !inRange : inRange;
      };
      const t = nfa.addTransition(s, { match: test, to: -1 });
      return { start: s, out: [t] };
    }

    case 'startAnchor': {
      const s = nfa.addState();
      const t = nfa.addTransition(s, { anchor: 'start', to: -1 });
      return { start: s, out: [t] };
    }

    case 'endAnchor': {
      const s = nfa.addState();
      const t = nfa.addTransition(s, { anchor: 'end', to: -1 });
      return { start: s, out: [t] };
    }

    case 'group':
      return build(node.child, nfa);

    case 'concat': {
      let current = build(node.parts[0], nfa);
      for (let i = 1; i < node.parts.length; i++) {
        const next = build(node.parts[i], nfa);
        patch(current.out, next.start);
        current = { start: current.start, out: next.out };
      }
      return current;
    }

    case 'alt': {
      const s = nfa.addState();
      const outs = [];
      for (const option of node.options) {
        const frag = build(option, nfa);
        nfa.addTransition(s, { eps: true, to: frag.start });
        outs.push(...frag.out);
      }
      return { start: s, out: outs };
    }

    case 'star': {
      const s = nfa.addState();
      const frag = build(node.child, nfa);
      nfa.addTransition(s, { eps: true, to: frag.start });
      patch(frag.out, s);
      const t = nfa.addTransition(s, { eps: true, to: -1 });
      return { start: s, out: [t] };
    }

    case 'plus': {
      const frag = build(node.child, nfa);
      const s = nfa.addState();
      nfa.addTransition(s, { eps: true, to: frag.start });
      patch(frag.out, s);
      const t = nfa.addTransition(s, { eps: true, to: -1 });
      return { start: frag.start, out: [t] };
    }

    case 'opt': {
      const s = nfa.addState();
      const frag = build(node.child, nfa);
      nfa.addTransition(s, { eps: true, to: frag.start });
      const t = nfa.addTransition(s, { eps: true, to: -1 });
      return { start: s, out: [...frag.out, t] };
    }

    default:
      throw new Error(`Unknown AST node type: ${node.type}`);
  }
}

// ---------------------------------------------------------------------
// 3. Simulator: run the NFA over an input string
// ---------------------------------------------------------------------
//
// addState() below performs epsilon-closure: given a starting state, it
// adds every state reachable via eps/anchor transitions (subject to the
// anchor being legal at the current position) to a Set, recursively.
// stepAll() then advances every state in the current set by one input
// character. Running this to completion from a given start index, and
// remembering the furthest position at which the accept state appeared
// in the closure, gives a leftmost-longest match - the same semantics
// POSIX regex tools use, and one that can never backtrack exponentially.

function epsilonClosure(nfa, stateIds, pos, length) {
  const stack = [...stateIds];
  const seen = new Set(stateIds);
  while (stack.length) {
    const id = stack.pop();
    for (const t of nfa.states[id].transitions) {
      if (t.eps && !seen.has(t.to)) {
        seen.add(t.to);
        stack.push(t.to);
      } else if (t.anchor === 'start' && pos === 0 && !seen.has(t.to)) {
        seen.add(t.to);
        stack.push(t.to);
      } else if (t.anchor === 'end' && pos === length && !seen.has(t.to)) {
        seen.add(t.to);
        stack.push(t.to);
      }
    }
  }
  return seen;
}

/**
 * Try to match `compiled` starting exactly at `startIndex` in `input`.
 * Returns the longest match end index (exclusive) reachable, or -1 if
 * the pattern never matches starting at startIndex.
 */
function matchFrom(compiled, input, startIndex) {
  const { nfa, start, accept } = compiled;
  let current = epsilonClosure(nfa, [start], startIndex, input.length);
  let longestEnd = current.has(accept) ? startIndex : -1;

  let pos = startIndex;
  while (pos < input.length && current.size > 0) {
    const ch = input[pos];
    const nextRaw = new Set();
    for (const id of current) {
      for (const t of nfa.states[id].transitions) {
        if (t.match && t.match(ch)) {
          nextRaw.add(t.to);
        }
      }
    }
    pos += 1;
    current = epsilonClosure(nfa, [...nextRaw], pos, input.length);
    if (current.has(accept)) {
      longestEnd = pos;
    }
  }

  return longestEnd;
}

// ---------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------

class RegexEngine {
  /** @param {string} pattern */
  constructor(pattern) {
    this.source = pattern;
    this.ast = parsePattern(pattern);
    this.compiled = compile(this.ast);
  }

  /** True if the *entire* string matches the pattern (like ^...$). */
  test(input) {
    const end = matchFrom(this.compiled, input, 0);
    return end === input.length;
  }

  /**
   * Find the first  (leftmost-longest) match anywhere in the string.
   * Returns { start, end, text } or null.
   */
  search(input) {
    for (let i = 0; i <= input.length; i++) {
      const end = matchFrom(this.compiled, input, i);
      if (end !== -1) {
        return { start: i, end, text: input.slice(i, end) };
      }
    }
    return null;
  }

  /** Find all non-overlapping matches in the string. */
  findAll(input) {
    const matches = [];
    let i = 0;
    while (i <= input.length) {
      const end = matchFrom(this.compiled, input, i);
      if (end === -1) {
        i += 1;
        continue;
      }
      matches.push({ start: i, end, text: input.slice(i, end) });
      i = end > i ? end : i + 1; // avoid infinite loop on empty matches
    }
    return matches;
  }
}

// Works as a CommonJS module (Node, `require`) and as a plain script
// tag in the browser (attaches to `window.RegexEngineLib`).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { RegexEngine, parsePattern, compile, ParseError };
} else if (typeof window !== 'undefined') {
  window.RegexEngineLib = { RegexEngine, parsePattern, compile, ParseError };
}
