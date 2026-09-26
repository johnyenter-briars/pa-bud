// A small, non-evaluating expression language for JSON loop items.
// No eval/Function, globals, arbitrary calls, or access to prototypes.
(() => {
  'use strict';
  const blocked = new Set(['__proto__', 'prototype', 'constructor']);
  const functions = {
    equals: (a, b) => a === b,
    contains: (a, b) => typeof a === 'string' || Array.isArray(a) ? a.includes(b) : false,
    startsWith: (a, b) => typeof a === 'string' && a.startsWith(b),
    endsWith: (a, b) => typeof a === 'string' && a.endsWith(b),
    empty: (a) => a == null || a === '' || (Array.isArray(a) && !a.length),
    length: (a) => typeof a === 'string' || Array.isArray(a) ? a.length : 0,
    toLower: (a) => typeof a === 'string' ? a.toLowerCase() : a,
  };

  function compile(source) {
    if (source.length > 2000) throw new Error('Keep the expression under 2,000 characters.');
    source = source.trim().replace(/^@/, '');
    const pattern = /\s*(===|!==|==|!=|<=|>=|&&|\|\||[()[\].,?!<>]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*)/gy;
    const tokens = [];
    let offset = 0;
    while (offset < source.length) {
      pattern.lastIndex = offset;
      const m = pattern.exec(source);
      if (!m) throw new Error(`Unexpected character at position ${offset + 1}.`);
      tokens.push(m[1]);
      offset = pattern.lastIndex;
      if (tokens.length > 256) throw new Error('This expression is too complex.');
    }
    let pos = 0, depth = 0;
    const peek = () => tokens[pos];
    const take = (expected) => {
      const token = tokens[pos++];
      if (expected && token !== expected) throw new Error(`Expected ${expected}.`);
      return token;
    };
    const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '<=': 4, '>': 4, '>=': 4 };
    function primary() {
      if (++depth > 32) throw new Error('This expression is nested too deeply.');
      const token = take();
      let node;
      if (token === '!') node = { type: 'not', value: primary() };
      else if (token === '(') { node = expression(1); take(')'); }
      else if (token && /^['"]/.test(token)) {
        let value = '';
        for (let i = 1; i < token.length - 1; i++) {
          if (token[i] !== '\\') { value += token[i]; continue; }
          const ch = token[++i];
          if (ch === 'u') {
            const hex = token.slice(i + 1, i + 5);
            if (!/^[0-9a-f]{4}$/i.test(hex)) throw new Error('Invalid Unicode escape.');
            value += String.fromCharCode(parseInt(hex, 16)); i += 4;
          } else {
            const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '\\': '\\', '"': '"', "'": "'", '/': '/' };
            if (!Object.hasOwn(escapes, ch)) throw new Error('Invalid string escape.');
            value += escapes[ch];
          }
        }
        node = { type: 'literal', value };
      } else if (token && /^-?\d/.test(token)) node = { type: 'literal', value: Number(token) };
      else if (['true', 'false', 'null'].includes(token)) node = { type: 'literal', value: JSON.parse(token) };
      else if (token === 'item' || token === 'index' || Object.hasOwn(functions, token || '')) {
        take('(');
        const args = [];
        if (peek() !== ')') {
          do { args.push(expression(1)); if (peek() !== ',') break; take(','); } while (true);
        }
        take(')');
        if ((token === 'item' || token === 'index') && args.length) throw new Error(`${token}() takes no arguments.`);
        node = { type: 'call', name: token, args };
      } else throw new Error('Expected item(), a value, or a supported function.');
      while (peek() === '[' || peek() === '.' || peek() === '?') {
        if (peek() === '?') { take('?'); if (peek() !== '[' && peek() !== '.') throw new Error('Expected a property after ?.'); }
        let key;
        if (peek() === '.') { take('.'); key = take(); if (!/^[A-Za-z_$][\w$]*$/.test(key || '')) throw new Error('Expected a property name.'); }
        else {
          take('[');
          const property = primary();
          if (property.type !== 'literal' || !['string', 'number'].includes(typeof property.value)) throw new Error('Use a quoted property name or array index.');
          key = property.value;
          take(']');
        }
        if (blocked.has(String(key))) throw new Error('That property is not available.');
        node = { type: 'property', value: node, key };
      }
      depth--;
      return node;
    }
    function expression(min) {
      let node = primary();
      while ((precedence[peek()] || 0) >= min) {
        const op = take();
        node = { type: 'binary', op, left: node, right: expression(precedence[op] + 1) };
      }
      return node;
    }
    const ast = expression(1);
    if (pos !== tokens.length) throw new Error(`Unexpected ${peek()}.`);
    function evaluate(node, item, index) {
      const ev = (child) => evaluate(child, item, index);
      if (node.type === 'literal') return node.value;
      if (node.type === 'not') return !ev(node.value);
      if (node.type === 'property') {
        const value = ev(node.value);
        return value != null && Object.hasOwn(Object(value), node.key) ? value[node.key] : undefined;
      }
      if (node.type === 'call') {
        if (node.name === 'item') return item;
        if (node.name === 'index') return index;
        return functions[node.name](...node.args.map(ev));
      }
      const a = ev(node.left);
      if (node.op === '&&') return a && ev(node.right);
      if (node.op === '||') return a || ev(node.right);
      const b = ev(node.right);
      switch (node.op) {
        case '==': return a == b; // Intentional familiar, coercing equality.
        case '!=': return a != b;
        case '===': return a === b;
        case '!==': return a !== b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        default: return false;
      }
    }
    return (item, index) => Boolean(evaluate(ast, item, index));
  }
  globalThis.__paIterationExpression = { compile };
})();
