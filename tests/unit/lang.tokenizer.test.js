import { describe, it, expect } from 'vitest';
import { tokenize, ForgeError } from '../../src/lang/tokenizer.js';

// Convenience: strip the eof token so we can assert on the meaningful tokens.
const stripEof = (tokens) => {
  const last = tokens[tokens.length - 1];
  expect(last.type).toBe('eof');
  expect(last.value).toBeNull();
  return tokens.slice(0, -1);
};

describe('tokenizer — numbers', () => {
  it('tokenizes an integer with no unit', () => {
    const [n] = stripEof(tokenize('10'));
    expect(n.type).toBe('number');
    expect(n.value).toEqual({ value: 10, unit: null });
  });

  it('tokenizes a decimal', () => {
    const [n] = stripEof(tokenize('2.5'));
    expect(n.type).toBe('number');
    expect(n.value.value).toBeCloseTo(2.5);
    expect(n.value.unit).toBeNull();
  });

  it('tokenizes a leading-dot decimal', () => {
    const [n] = stripEof(tokenize('.75'));
    expect(n.type).toBe('number');
    expect(n.value.value).toBeCloseTo(0.75);
  });

  it('attaches a mm unit suffix', () => {
    const [n] = stripEof(tokenize('10mm'));
    expect(n.value).toEqual({ value: 10, unit: 'mm' });
  });

  it('supports cm, deg and rad unit suffixes', () => {
    expect(stripEof(tokenize('3cm'))[0].value).toEqual({ value: 3, unit: 'cm' });
    expect(stripEof(tokenize('90deg'))[0].value).toEqual({ value: 90, unit: 'deg' });
    expect(stripEof(tokenize('1.5rad'))[0].value.unit).toBe('rad');
  });

  it('parses scientific notation', () => {
    const [n] = stripEof(tokenize('1e3'));
    expect(n.value.value).toBeCloseTo(1000);
    const [m] = stripEof(tokenize('2.5e-2'));
    expect(m.value.value).toBeCloseTo(0.025);
  });
});

describe('tokenizer — identifiers, strings, operators, punctuation', () => {
  it('tokenizes an identifier', () => {
    const [id] = stripEof(tokenize('width_1'));
    expect(id.type).toBe('ident');
    expect(id.value).toBe('width_1');
  });

  it('tokenizes a double-quoted string', () => {
    const [s] = stripEof(tokenize('"hello"'));
    expect(s.type).toBe('string');
    expect(s.value).toBe('hello');
  });

  it('tokenizes a single-quoted string', () => {
    const [s] = stripEof(tokenize("'world'"));
    expect(s.type).toBe('string');
    expect(s.value).toBe('world');
  });

  it('applies escape sequences inside strings', () => {
    const [s] = stripEof(tokenize('"a\\nb\\tc\\""'));
    expect(s.value).toBe('a\nb\tc"');
  });

  it('tokenizes two-char operators as op tokens', () => {
    const ops = ['<=', '>=', '==', '!=', '&&', '||'];
    for (const op of ops) {
      const [t] = stripEof(tokenize(op));
      expect(t.type).toBe('op');
      expect(t.value).toBe(op);
    }
  });

  it('tokenizes single-char punctuation as punct tokens', () => {
    const toks = stripEof(tokenize('(){}[],;=+-*/%<>.:!'));
    expect(toks.every((t) => t.type === 'punct')).toBe(true);
    expect(toks.map((t) => t.value).join('')).toBe('(){}[],;=+-*/%<>.:!');
  });

  it('tokenizes a bare ! as a punct token (logical not)', () => {
    const [t] = stripEof(tokenize('!'));
    expect(t.type).toBe('punct');
    expect(t.value).toBe('!');
  });

  it('still tokenizes != as one two-char op (not ! followed by =)', () => {
    const toks = stripEof(tokenize('!='));
    expect(toks).toHaveLength(1);
    expect(toks[0]).toMatchObject({ type: 'op', value: '!=' });
  });

  it('tokenizes !x as a not-operator then an identifier', () => {
    const toks = stripEof(tokenize('!x'));
    expect(toks.map((t) => [t.type, t.value])).toEqual([
      ['punct', '!'],
      ['ident', 'x'],
    ]);
  });

  it('always appends a trailing eof token', () => {
    const tokens = tokenize('1 + 2');
    expect(tokens[tokens.length - 1].type).toBe('eof');
    // ident/number/op/punct counts aside, eof is exactly one and last.
    expect(tokens.filter((t) => t.type === 'eof')).toHaveLength(1);
  });

  it('tokenizes a small mixed expression in order', () => {
    const types = stripEof(tokenize('cube(10mm)')).map((t) => t.type);
    expect(types).toEqual(['ident', 'punct', 'number', 'punct']);
  });
});

describe('tokenizer — positions', () => {
  // line/col mark where a token BEGINS (1-based); `start`/`end` are the
  // [start, end) character-offset span. The editor maps a caret to a shape via
  // start/end; the parser uses line/col for error messages.
  it('records char-offset span via start/end', () => {
    // 'ab cd' -> two idents.
    const [a, b] = stripEof(tokenize('ab cd'));
    expect(a.start).toBe(0);
    expect(a.end).toBe(2); // 'ab' occupies [0,2)
    expect(b.start).toBe(3); // 'cd' begins after the space
    expect(b.end).toBe(5);
  });

  it('records line/col at the start of each token', () => {
    const [a, b] = stripEof(tokenize('ab cd'));
    expect(a.line).toBe(1);
    expect(a.col).toBe(1); // 'ab' begins at column 1
    expect(b.line).toBe(1);
    expect(b.col).toBe(4); // 'cd' begins at column 4 (after 'ab' and a space)
  });

  it('advances line numbers across newlines', () => {
    const [a, b] = stripEof(tokenize('a\nb'));
    expect(a.line).toBe(1);
    expect(a.col).toBe(1);
    expect(b.line).toBe(2);
    expect(b.col).toBe(1); // 'b' begins at the start of line 2
    expect(b.start).toBe(2); // offset 2 (after 'a' and '\n')
  });

  it('sets token end past the last consumed char', () => {
    const [n] = stripEof(tokenize('10mm'));
    expect(n.start).toBe(0);
    expect(n.end).toBe(4); // exclusive offset after 'mm' (length 4)
    expect(n.col).toBe(1); // the number begins at column 1
  });
});

describe('tokenizer — comments', () => {
  it('skips line comments', () => {
    const toks = stripEof(tokenize('1 // a comment\n2'));
    expect(toks.map((t) => t.value.value)).toEqual([1, 2]);
  });

  it('skips block comments', () => {
    const toks = stripEof(tokenize('1 /* skip\nthis */ 2'));
    expect(toks).toHaveLength(2);
    expect(toks[0].value.value).toBe(1);
    expect(toks[1].value.value).toBe(2);
  });

  it('returns only eof for a comment-only source', () => {
    const tokens = tokenize('// nothing here');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('eof');
  });
});

describe('tokenizer — errors', () => {
  it('throws on an unterminated string', () => {
    expect(() => tokenize('"oops')).toThrow();
    expect(() => tokenize('"oops')).toThrow(ForgeError);
  });

  it('throws on an illegal character', () => {
    expect(() => tokenize('@')).toThrow(ForgeError);
  });

  it('ForgeError carries line/col metadata', () => {
    let err;
    try {
      tokenize('@');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ForgeError);
    expect(err.name).toBe('ForgeError');
    expect(err.line).toBe(1);
    expect(typeof err.col).toBe('number');
  });
});
