(function() {
  'use strict';

  // Operator registry
  const Operators = {
    NOT:  { sym: 'NOT',  arity: 1, prec: 5, assoc: 'right', fn: a => !a },
    AND:  { sym: 'AND',  arity: 2, prec: 4, assoc: 'left',  fn: (a,b) => a && b },
    XOR:  { sym: 'XOR',  arity: 2, prec: 3, assoc: 'left',  fn: (a,b) => Boolean(a) !== Boolean(b) },
    OR:   { sym: 'OR',   arity: 2, prec: 2, assoc: 'left',  fn: (a,b) => a || b },
    IMP:  { sym: 'IMP',  arity: 2, prec: 1, assoc: 'right', fn: (a,b) => (!a) || b },
    IFF:  { sym: 'IFF',  arity: 2, prec: 0, assoc: 'left',  fn: (a,b) => a === b },
  };

  // Map surface tokens (multi-lingual/symbolic) to canonical operator keys
  // Longest-first matching is ensured by tokenizer.
  const OperatorLexemes = [
    // Biconditional (↔, <->, <=>, iff)
    { m: '<=>', op: 'IFF' },
    { m: '<->', op: 'IFF' },
    { m: '↔',   op: 'IFF' },
    { m: 'iff', op: 'IFF' },

    // Implication (→, ->, =>, implies)
    { m: '->',      op: 'IMP' },
    { m: '=>',      op: 'IMP' },
    { m: '→',       op: 'IMP' },
    { m: 'implies', op: 'IMP' },

    // XOR (⊕, ^, xor)
    { m: '⊕',   op: 'XOR' },
    { m: '^',   op: 'XOR' },
    { m: 'xor', op: 'XOR' },

    // AND (∧, &, and)
    { m: '∧',   op: 'AND' },
    { m: '&',   op: 'AND' },
    { m: 'and', op: 'AND' },

    // OR (∨, |, or)
    { m: '∨',  op: 'OR' },
    { m: '|',  op: 'OR' },
    { m: 'or', op: 'OR' },

    // NOT (¬, ~, !, not)
    { m: '¬',   op: 'NOT' },
    { m: '~',   op: 'NOT' },
    { m: '!',   op: 'NOT' },
    { m: 'not', op: 'NOT' },
  ];

  const ConstLexemes = new Map([
    ['true', true], ['t', true], ['1', true],
    ['false', false], ['f', false], ['0', false],
  ]);

  function isLetter(ch) { return /[A-Za-z]/.test(ch); }
  function isDigit(ch) { return /[0-9]/.test(ch); }
  function isIdentStart(ch) { return /[A-Za-z_]/.test(ch); }
  function isIdentPart(ch) { return /[A-Za-z0-9_]/.test(ch); }

  function tokenize(input) {
    const s = input.trim();
    const tokens = [];
    let i = 0;

    const matchOperatorAt = (idx) => {
      for (const { m, op } of OperatorLexemes) {
        if (s.startsWith(m, idx)) return { m, op };
      }
      return null;
    };

    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

      // Parentheses
      if (ch === '(') { tokens.push({ type: 'lparen', value: '(' }); i++; continue; }
      if (ch === ')') { tokens.push({ type: 'rparen', value: ')' }); i++; continue; }

      // Multi/single-char operators
      const op = matchOperatorAt(i);
      if (op) {
        tokens.push({ type: 'op', value: op.op, raw: op.m });
        i += op.m.length;
        continue;
      }

      // Identifier or reserved word/constant
      if (isIdentStart(ch)) {
        let j = i + 1;
        while (j < s.length && isIdentPart(s[j])) j++;
        const wordRaw = s.slice(i, j);
        const word = wordRaw.toLowerCase();
        if (ConstLexemes.has(word)) {
          tokens.push({ type: 'const', value: ConstLexemes.get(word), raw: wordRaw });
        } else {
          // Might also be a textual operator; check map
          const asOp = OperatorLexemes.find(o => o.m === word);
          if (asOp) {
            tokens.push({ type: 'op', value: asOp.op, raw: wordRaw });
          } else {
            tokens.push({ type: 'ident', value: wordRaw });
          }
        }
        i = j;
        continue;
      }

      // Digits-only constants (e.g., 0/1) handled above via ident; for stray digits, error
      if (isDigit(ch)) {
        // allow single 0/1 without letters
        let j = i; while (j < s.length && isDigit(s[j])) j++;
        const numStr = s.slice(i, j);
        if (numStr === '0' || numStr === '1') {
          tokens.push({ type: 'const', value: numStr === '1', raw: numStr });
          i = j; continue;
        } else {
          throw new Error(`Unexpected number '${numStr}'. Only 0 or 1 are allowed as constants.`);
        }
      }

      throw new Error(`Unexpected character '${ch}' at position ${i + 1}`);
    }

    // Disambiguate unary NOT vs binary (NOT is only unary in our grammar, so okay)
    return tokens;
  }

  function toRPN(tokens) {
    const output = [];
    const ops = [];

    // Track previous token to detect unary NOT context if needed
    let prevType = 'start';

    for (const tok of tokens) {
      if (tok.type === 'ident' || tok.type === 'const') {
        output.push(tok);
        prevType = 'value';
      } else if (tok.type === 'op') {
        const opInfo = Operators[tok.value];
        if (!opInfo) throw new Error(`Unknown operator '${tok.raw ?? tok.value}'`);

        // Shunting-yard: pop while stack top has higher precedence, or equal precedence and left-assoc
        while (ops.length) {
          const top = ops[ops.length - 1];
          if (top.type !== 'op') break;
          const topInfo = Operators[top.value];
          if ((topInfo.prec > opInfo.prec) || (topInfo.prec === opInfo.prec && opInfo.assoc === 'left')) {
            output.push(ops.pop());
          } else {
            break;
          }
        }
        ops.push(tok);
        prevType = 'op';
      } else if (tok.type === 'lparen') {
        ops.push(tok);
        prevType = 'lparen';
      } else if (tok.type === 'rparen') {
        let found = false;
        while (ops.length) {
          const t = ops.pop();
          if (t.type === 'lparen') { found = true; break; }
          output.push(t);
        }
        if (!found) throw new Error('Mismatched parentheses: missing "("');
        prevType = 'rparen';
      } else {
        throw new Error(`Unexpected token: ${JSON.stringify(tok)}`);
      }
    }

    while (ops.length) {
      const t = ops.pop();
      if (t.type === 'lparen' || t.type === 'rparen') throw new Error('Mismatched parentheses');
      output.push(t);
    }
    return output;
  }

  // Build AST from RPN for step-by-step evaluation
  function rpnToAst(rpn) {
    let nextId = 1;
    const stack = [];
    const makeLeaf = (tok) => (
      tok.type === 'ident'
        ? { id: nextId++, type: 'var', name: tok.value }
        : { id: nextId++, type: 'const', value: Boolean(tok.value) }
    );
    for (const tok of rpn) {
      if (tok.type === 'ident' || tok.type === 'const') {
        stack.push(makeLeaf(tok));
      } else if (tok.type === 'op') {
        const info = Operators[tok.value];
        if (info.arity === 1) {
          const a = stack.pop();
          if (!a) throw new Error('Invalid expression: missing operand for unary operator');
          stack.push({ id: nextId++, type: 'op', op: tok.value, a });
        } else if (info.arity === 2) {
          const b = stack.pop();
          const a = stack.pop();
          if (!a || !b) throw new Error('Invalid expression: missing operands for binary operator');
          stack.push({ id: nextId++, type: 'op', op: tok.value, a, b });
        } else {
          throw new Error('Unsupported operator arity');
        }
      } else {
        throw new Error('Unexpected token in AST build');
      }
    }
    if (stack.length !== 1) throw new Error('Invalid expression: could not build AST');
    return stack[0];
  }
  // Operator labels for display
  const OpLabel = {
    NOT: '!',
    AND: '&',
    OR: '|',
    XOR: '^',
    IMP: '->',
    IFF: '<->',
  };

  function formatNode(node) {
    switch (node.type) {
      case 'var': return node.name;
      case 'const': return node.value ? 'T' : 'F';
      case 'op': {
        if (node.op === 'NOT') {
          const inner = formatNode(node.a);
          const needsParens = node.a.type === 'op';
          return OpLabel.NOT + (needsParens ? `(${inner})` : inner);
        }
        const left = formatNode(node.a);
        const right = formatNode(node.b);
        return `(${left} ${OpLabel[node.op]} ${right})`;
      }
      default: return '?';
    }
  }

  function collectSubexpressions(root) {
    const order = [];
    const seen = new Set(); // de-duplicate by label
    const visit = (n) => {
      if (n.type === 'op') {
        visit(n.a);
        if (n.b) visit(n.b);
        const label = formatNode(n);
        if (!seen.has(label)) {
          seen.add(label);
          order.push({ node: n, label });
        }
      }
    };
    visit(root);
    return order;
  }

  function computeValue(node, env, cache) {
    if (cache.has(node.id)) return cache.get(node.id);
    let val;
    if (node.type === 'var') {
      if (!(node.name in env)) throw new Error(`Unbound variable '${node.name}'`);
      val = Boolean(env[node.name]);
    } else if (node.type === 'const') {
      val = Boolean(node.value);
    } else if (node.type === 'op') {
      const info = Operators[node.op];
      if (info.arity === 1) {
        val = info.fn(computeValue(node.a, env, cache));
      } else if (info.arity === 2) {
        val = info.fn(
          computeValue(node.a, env, cache),
          computeValue(node.b, env, cache)
        );
      } else {
        throw new Error('Unsupported operator arity');
      }
    } else {
      throw new Error('Unknown node type');
    }
    cache.set(node.id, val);
    return val;
  }

  function evalRPN(rpn, env) {
    const stack = [];
    for (const tok of rpn) {
      if (tok.type === 'ident') {
        if (!(tok.value in env)) throw new Error(`Unbound variable '${tok.value}'`);
        stack.push(Boolean(env[tok.value]));
      } else if (tok.type === 'const') {
        stack.push(Boolean(tok.value));
      } else if (tok.type === 'op') {
        const info = Operators[tok.value];
        if (info.arity === 1) {
          if (stack.length < 1) throw new Error('Invalid expression: missing operand for unary operator');
          const a = stack.pop();
          stack.push(info.fn(a));
        } else if (info.arity === 2) {
          if (stack.length < 2) throw new Error('Invalid expression: missing operands for binary operator');
          const b = stack.pop();
          const a = stack.pop();
          stack.push(info.fn(a, b));
        } else {
          throw new Error('Unsupported operator arity');
        }
      } else {
        throw new Error('Unexpected token in evaluation');
      }
    }
    if (stack.length !== 1) throw new Error('Invalid expression: leftover values after evaluation');
    return stack[0];
  }

  function uniqueVariables(tokens) {
    const set = new Set();
    for (const t of tokens) if (t.type === 'ident') set.add(t.value);
    return Array.from(set).sort((a,b) => a.localeCompare(b));
  }

  function renderTable(vars, rpn, options) {
    const { showTF, showRowIndex, showSteps, rowOrder } = options;
    const container = document.getElementById('table-container');
    container.innerHTML = '';

    const tbl = document.createElement('table');

    // Header
    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    if (showRowIndex) {
      const th = document.createElement('th');
      th.textContent = '#';
      trh.appendChild(th);
    }
    for (const v of vars) {
      const th = document.createElement('th');
      th.textContent = v;
      trh.appendChild(th);
    }
    // Steps headers (subexpressions)
    let ast = null;
    let steps = [];
    if (showSteps) {
      ast = rpnToAst(rpn);
      steps = collectSubexpressions(ast);
      for (const { label } of steps) {
        const th = document.createElement('th');
        th.textContent = label;
        trh.appendChild(th);
      }
    }
    const thRes = document.createElement('th');
    thRes.textContent = 'Result';
    trh.appendChild(thRes);
    thead.appendChild(trh);

    // Body
    const tbody = document.createElement('tbody');
    const rowCount = 1 << vars.length;

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < rowCount; i++) {
      const env = Object.create(null);
      for (let j = 0; j < vars.length; j++) {
        const bit = (i >> (vars.length - j - 1)) & 1;
        const val = rowOrder === 'F_FIRST' ? (bit === 1) : (bit === 0);
        env[vars[j]] = val;
      }
      let value;
      try {
        if (showSteps) {
          if (!ast) ast = rpnToAst(rpn);
        }
        value = evalRPN(rpn, env);
      } catch (e) {
        value = false;
      }

      const tr = document.createElement('tr');
      if (showRowIndex) {
        const td = document.createElement('td');
        td.textContent = String(i + 1);
        tr.appendChild(td);
      }
      for (const v of vars) {
        const val = env[v];
        const td = document.createElement('td');
        td.className = val ? 't' : 'f';
        td.textContent = showTF ? (val ? 'T' : 'F') : (val ? '1' : '0');
        tr.appendChild(td);
      }
      if (showSteps) {
        const cache = new Map();
        for (const { node } of steps) {
          const sval = computeValue(node, env, cache);
          const td = document.createElement('td');
          td.className = sval ? 't' : 'f';
          td.textContent = showTF ? (sval ? 'T' : 'F') : (sval ? '1' : '0');
          tr.appendChild(td);
        }
      }
      const tdRes = document.createElement('td');
      tdRes.className = value ? 't' : 'f';
      tdRes.textContent = showTF ? (value ? 'T' : 'F') : (value ? '1' : '0');
      tr.appendChild(tdRes);

      fragment.appendChild(tr);
    }

    tbody.appendChild(fragment);

    tbl.appendChild(thead);
    tbl.appendChild(tbody);

    container.appendChild(tbl);
  }

  function updateSummary(expr, vars) {
    const summary = document.getElementById('summary');
    summary.hidden = false;
    summary.innerHTML = `Variables: <code>${vars.join(', ') || '(none)'}</code> · Rows: <code>${1 << vars.length}</code> · Expression: <code>${escapeHtml(expr)}</code>`;
  }

  function escapeHtml(x) {
    return x.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  function showError(msg) {
    const el = document.getElementById('error');
    el.hidden = false;
    el.textContent = msg;
  }

  function clearError() {
    const el = document.getElementById('error');
    el.hidden = true;
    el.textContent = '';
  }

  function handleSubmit(e) {
    e.preventDefault();
    clearError();

    const exprInput = document.getElementById('expression');
    const showTF = document.getElementById('useTF').checked;
    const showRowIndex = document.getElementById('showRowIndex').checked;
    const showSteps = document.getElementById('showSteps').checked;
    const rowOrder = document.getElementById('rowOrder').value;

    const expr = exprInput.value.trim();
    if (!expr) { showError('Please enter an expression.'); return; }

    let tokens;
    try {
      tokens = tokenize(expr);
    } catch (err) {
      showError(err.message);
      return;
    }

    const vars = uniqueVariables(tokens);
    if (vars.length > 12) {
      showError(`Too many variables (${vars.length}). This would create ${1 << vars.length} rows. Limit is 12 variables.`);
      return;
    }

    let rpn;
    try {
      rpn = toRPN(tokens);
    } catch (err) {
      showError(err.message);
      return;
    }

    try {
      renderTable(vars, rpn, { showTF, showRowIndex, showSteps, rowOrder });
      updateSummary(expr, vars);
    } catch (err) {
      showError(err.message);
    }
  }

  // Init
  window.addEventListener('DOMContentLoaded', () => {
    document.getElementById('expr-form').addEventListener('submit', handleSubmit);
  });
})();
