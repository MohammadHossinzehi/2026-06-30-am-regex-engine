# Regex Engine From Scratch

A regular expression engine implemented from first principles in plain
JavaScript: a recursive-descent parser, Thompson's construction to build
an NFA, and a Pike-style breadth-first NFA simulation to match. No
native `RegExp` object is used anywhere in the matching path.

## Why this exists

Most "write a regex engine" exercises stop at a backtracking matcher,
which is short to write but has a well-known flaw: certain patterns
(`(a+)+b` against a long run of `a`s with no trailing `b`, for example)
cause exponential blowup because the engine retries every possible split
of every repetition before giving up. This is a real, recurring cause of
production outages (look up "ReDoS" - regular expression denial of
service).

This implementation avoids that failure mode entirely by never
backtracking. Instead of exploring one branch of the search space at a
time, it tracks the *set* of NFA states the engine could simultaneously
be in after each input character (Thompson 1968, popularized for
practical engines by Russ Cox / Rob Pike). That keeps matching to
`O(pattern_length * input_length)` time no matter how the pattern is
written, at the cost of not supporting backreferences (which fundamentally
require backtracking and make the matching problem NP-hard in general).

## What it supports

- Literals, concatenation: `abc`
- Alternation: `cat|dog`
- Quantifiers: `a*`, `a+`, `a?`
- Grouping: `(ab|cd)+`
- Any character: `.`
- Character classes: `[abc]`, `[^abc]`, `[a-z0-9]`
- Shorthand classes: `\d`, `\D`, `\w`, `\W`, `\s`, `\S`
- Anchors: `^`, `$`
- Escaped literals: `\.`, `\*`, `\\`, etc.

Not supported (deliberately, to keep the linear-time guarantee intact):
bounded repetition counts (`{m,n}`), capture groups / backreferences,
and lookaround. These all either need extra machinery (counting states)
or backtracking semantics that conflict with the project's goal.

## How to run it

Requires Node.js 18+, no dependencies to install.

```bash
# Run the test suite
npm test

# Or use it directly
node -e "
const { RegexEngine } = require('./src/regex-engine.js');
const re = new RegexEngine('\\\\d+@\\\\w+\\\\.com');
console.log(re.search('contact me at user@example.com').text);
"
```

There is also a zero-build browser demo: open `index.html` directly in
any browser (no server needed - it loads `src/regex-engine.js` as a
plain `<script>` tag). Type a pattern and a test string and matches are
highlighted live.

## API

```js
const { RegexEngine } = require('./src/regex-engine.js');

const re = new RegexEngine('[A-Za-z]+');

re.test('Hello');              // true  - whole-string match, like ^...$
re.search('Hello, World!');    // { start: 0, end: 5, text: 'Hello' }
re.findAll('Hello, World!');   // [{start:0,end:5,text:'Hello'}, {start:7,end:12,text:'World'}]
```

`parsePattern` and `compile` are also exported individually if you want
to inspect the AST or the raw NFA, which is handy for debugging the
engine itself.

## Design decisions

- **Three explicit stages (parse / compile / simulate)** rather than a
  single recursive matcher. This mirrors how real engines (RE2, Rust's
  `regex` crate) are structured and makes each stage independently
  testable - the parser can be unit tested on its own without touching
  the NFA at all, for instance.
- **Fragments with dangling outputs** for NFA construction (the standard
  technique from Russ Cox's "Regular Expression Matching Can Be Simple
  And Fast"): each AST node compiles to a fragment with one entry state
  and a list of not-yet-connected exit transitions, which get patched
  when the next fragment is attached. This keeps the compiler a single
  pass with no second "linking" step.
- **Leftmost-longest matching**, not leftmost-first. Because the
  simulation tracks an entire *set* of active states, it naturally finds
  the longest match reachable from a given start position (see the
  `a|ab` test case) rather than committing to whichever alternative was
  written first in the pattern - the same semantics POSIX `grep` uses,
  and arguably more predictable than Perl-style backtracking engines.

## Testing

`test/regex-engine.test.js` uses Node's built-in test runner
(`node --test`, no external test framework needed) and covers: every
supported syntax feature individually, anchor behavior, `search` vs
`findAll` semantics, leftmost-longest matching, parse error handling on
malformed patterns, and a regression test that asserts `(a+)+b` against
2000 `a`s rejects in well under a second - the case that breaks naive
backtracking engines.

```
$ npm test
...
# tests 19
# pass 19
# fail 0
```
