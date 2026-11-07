// ── Lockdown calculator ─────────────────────────────────────────────────────
// A floating scientific calculator for quizzes taken in Safe Exam Browser, where
// a student can't reach any other. Loaded only there, by js/lockdown.js. Modelled on the one in Moodle exams. The
// button beside the theme controls shows and hides it; nothing here touches the
// quiz, and the calculation survives being hidden.
//
// Entry is one number at a time, as on a pocket calculator: functions like sin
// act on the number showing, and + − × ÷ follow normal precedence, so
// 2 + 3 × 4 = 14. The two-number functions read as they're written:
// 3 ⁿ√ 27 = 3 and 2 logₓy 8 = 3.
//
// CalcEngine has no DOM, so it can be tested on its own. Keys typed go to the
// calculator only while it has focus, so answer fields are never affected.

const CalcEngine = (() => {
  const SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷', pow: '^', root: 'ⁿ√', log: 'logₓ' };
  const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, pow: 3, root: 3, log: 3 };
  const MAX_DIGITS = 15;

  class CalcError extends Error {}

  // Floating-point noise, so sin 180° is 0 and 0.1 + 0.2 is 0.3.
  const tidy = (v) => (Math.abs(v) < 1e-13 ? 0 : Number(v.toPrecision(14)));

  function checked(v) {
    if (Number.isNaN(v)) throw new CalcError('Not defined');
    if (!Number.isFinite(v)) throw new CalcError('Too large');
    return v;
  }

  function nthRoot(n, x) {
    if (n === 0) throw new CalcError('Not defined');
    if (x >= 0) return Math.pow(x, 1 / n);
    if (Number.isInteger(n) && n % 2 !== 0) return -Math.pow(-x, 1 / n);
    throw new CalcError('Not defined');
  }

  function binary(op, a, b) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new CalcError("Can't divide by 0");
        return a / b;
      case 'pow': return Math.pow(a, b);
      case 'root': return nthRoot(a, b);
      case 'log':
        if (a <= 0 || a === 1 || b <= 0) throw new CalcError('Not defined');
        return Math.log(b) / Math.log(a);
      default: throw new CalcError('Not defined');
    }
  }

  // A number for the display: 12 significant digits, grouped, or powers of ten.
  function format(v) {
    if (v === 0) return '0';
    const abs = Math.abs(v);
    if (abs >= 1e12 || abs < 1e-6) {
      const [m, e] = v.toExponential(9).split('e');
      return `${m.replace(/\.?0+$/, '')}e${e.replace('+', '')}`;
    }
    return group(String(Number(v.toPrecision(12))));
  }

  function group(text) {
    const [whole, rest] = text.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return rest === undefined ? grouped : `${grouped}.${rest}`;
  }

  function create() {
    let entry = '0';
    let fresh = true;        // the next digit starts a new number
    let awaiting = false;    // an operator is waiting for its second number
    let done = false;        // the last key was =
    let label = null;        // how the number shows in the history, e.g. sin(30)
    let values = [];
    let ops = [];
    let history = [];
    let lastLine = '';
    let error = null;
    let degrees = true;
    let memory = 0;

    const number = () => Number(entry.replace(/e-?$/, '')) || 0;
    const toRadians = (v) => (degrees ? v * Math.PI / 180 : v);
    const fromRadians = (v) => (degrees ? v * 180 / Math.PI : v);

    const UNARY = {
      sin: { show: (x) => `sin(${x})`, run: (v) => tidy(Math.sin(toRadians(v))) },
      cos: { show: (x) => `cos(${x})`, run: (v) => tidy(Math.cos(toRadians(v))) },
      tan: {
        show: (x) => `tan(${x})`,
        run: (v) => {
          if (Math.abs(tidy(Math.cos(toRadians(v)))) === 0) throw new CalcError('Not defined');
          return tidy(Math.tan(toRadians(v)));
        },
      },
      ctg: {
        show: (x) => `ctg(${x})`,
        run: (v) => {
          if (Math.abs(tidy(Math.sin(toRadians(v)))) === 0) throw new CalcError('Not defined');
          return tidy(1 / Math.tan(toRadians(v)));
        },
      },
      asin: { show: (x) => `sin⁻¹(${x})`, run: (v) => tidy(fromRadians(Math.asin(v))) },
      acos: { show: (x) => `cos⁻¹(${x})`, run: (v) => tidy(fromRadians(Math.acos(v))) },
      atan: { show: (x) => `tan⁻¹(${x})`, run: (v) => tidy(fromRadians(Math.atan(v))) },
      actg: { show: (x) => `ctg⁻¹(${x})`, run: (v) => tidy(fromRadians(Math.atan2(1, v))) },
      ln: {
        show: (x) => `ln(${x})`,
        run: (v) => { if (v <= 0) throw new CalcError('Not defined'); return tidy(Math.log(v)); },
      },
      log10: {
        show: (x) => `log₁₀(${x})`,
        run: (v) => { if (v <= 0) throw new CalcError('Not defined'); return tidy(Math.log10(v)); },
      },
      square: { show: (x) => `(${x})²`, run: (v) => v * v },
      cube: { show: (x) => `(${x})³`, run: (v) => v * v * v },
      sqrt: {
        show: (x) => `√(${x})`,
        run: (v) => { if (v < 0) throw new CalcError('Not defined'); return tidy(Math.sqrt(v)); },
      },
      cbrt: { show: (x) => `∛(${x})`, run: (v) => tidy(Math.cbrt(v)) },
    };

    function clearAll() {
      entry = '0'; fresh = true; awaiting = false; done = false; label = null;
      values = []; ops = []; history = []; lastLine = ''; error = null;
    }

    function startNumber() {
      if (done) { done = false; lastLine = ''; }
      awaiting = false;
      label = null;
    }

    function setValue(v, newLabel) {
      entry = String(v);
      fresh = true;
      label = newLabel;
    }

    function reduceTo(precedence) {
      while (ops.length && PRECEDENCE[ops[ops.length - 1]] >= precedence) {
        const op = ops.pop();
        const b = values.pop();
        const a = values.pop();
        values.push(checked(binary(op, a, b)));
      }
    }

    function pushEntry() {
      values.push(number());
      history.push(label ?? format(number()));
    }

    function pressOperator(op) {
      if (awaiting && ops.length) {
        ops[ops.length - 1] = op;
        history[history.length - 1] = SYMBOLS[op];
        return;
      }
      if (done) { done = false; lastLine = ''; }
      pushEntry();
      // Powers chain from the right, the way 2^3^2 is read.
      reduceTo(PRECEDENCE[op] === 3 ? 4 : PRECEDENCE[op]);
      ops.push(op);
      history.push(SYMBOLS[op]);
      setValue(values[values.length - 1], null);
      awaiting = true;
    }

    function pressEquals() {
      if (awaiting && ops.length) { ops.pop(); history.pop(); awaiting = false; values.pop(); }
      if (!ops.length && !values.length && done) return;
      pushEntry();
      reduceTo(0);
      lastLine = `${history.join(' ')} =`;
      const result = tidy(values.pop());
      values = []; ops = []; history = [];
      setValue(result, null);
      done = true;
    }

    function pressUnary(name) {
      const fn = UNARY[name];
      const shown = label ?? format(number());
      const result = checked(fn.run(number()));
      if (done) { done = false; lastLine = ''; }
      awaiting = false;
      setValue(result, fn.show(shown));
    }

    function pressDigit(d) {
      if (fresh) {
        startNumber();
        entry = d;
        fresh = false;
        return;
      }
      if (entry.replace(/\D/g, '').length >= MAX_DIGITS) return;
      entry = entry === '0' ? d : entry + d;
    }

    function pressPoint() {
      if (fresh) { startNumber(); entry = '0.'; fresh = false; return; }
      if (!entry.includes('.') && !entry.includes('e')) entry += '.';
    }

    function pressExponent() {
      if (fresh) { startNumber(); entry = '1e'; fresh = false; return; }
      if (!entry.includes('e')) entry += 'e';
    }

    function pressSign() {
      if (fresh) { setValue(-number(), null); awaiting = false; return; }
      if (entry.includes('e')) {
        entry = entry.includes('e-') ? entry.replace('e-', 'e') : entry.replace('e', 'e-');
      } else {
        entry = entry.startsWith('-') ? entry.slice(1) : `-${entry}`;
      }
    }

    function pressDelete() {
      if (fresh) return;
      entry = entry.replace(/(e-?|.)$/, (m) => (m.startsWith('e') ? '' : ''));
      if (entry === '' || entry === '-') { entry = '0'; fresh = true; }
    }

    function pressClearEntry() {
      entry = '0'; fresh = true; label = null;
      awaiting = ops.length > 0;
    }

    function press(key) {
      if (key === 'C') { clearAll(); return; }
      if (error) {
        const startsAgain = /^[0-9.]$/.test(key) || key === 'CE';
        if (!startsAgain) return;
        clearAll();
        if (key === 'CE') return;
      }
      try {
        if (/^[0-9]$/.test(key)) pressDigit(key);
        else if (key === '.') pressPoint();
        else if (key === 'EE') pressExponent();
        else if (key === 'sign') pressSign();
        else if (key === 'DEL') pressDelete();
        else if (key === 'CE') pressClearEntry();
        else if (key === '=') pressEquals();
        else if (key in SYMBOLS) pressOperator(key);
        else if (key in UNARY) pressUnary(key);
        else if (key === 'pi' || key === 'e') {
          startNumber();
          setValue(key === 'pi' ? Math.PI : Math.E, key === 'pi' ? 'π' : 'e');
        } else if (key === 'M') { startNumber(); setValue(memory, 'M'); }
        else if (key === 'M+') { memory += number(); fresh = true; }
        else if (key === 'M-') { memory -= number(); fresh = true; }
        else if (key === 'angle') degrees = !degrees;
      } catch (e) {
        if (!(e instanceof CalcError)) throw e;
        error = e.message;
      }
    }

    function view() {
      return {
        display: error ?? (fresh ? format(number()) : group(entry).replace('e', 'e')),
        history: error ? '' : (history.length ? history.join(' ') : lastLine),
        degrees,
        hasMemory: memory !== 0,
        error: error !== null,
      };
    }

    return { press, view };
  }

  return { create };
})();

(function () {
  // Top to bottom: functions, then the keypad. [key, label, title, extra classes]
  const BUTTONS = [
    ['sin', 'sin', 'Sine'], ['cos', 'cos', 'Cosine'], ['tan', 'tan', 'Tangent'], ['ctg', 'ctg', 'Cotangent'], ['ln', 'ln', 'Natural logarithm'],
    ['asin', 'sin⁻¹', 'Inverse sine'], ['acos', 'cos⁻¹', 'Inverse cosine'], ['atan', 'tan⁻¹', 'Inverse tangent'], ['actg', 'ctg⁻¹', 'Inverse cotangent'], ['log10', 'log₁₀', 'Logarithm base 10'],
    ['square', 'x²', 'Square'], ['cube', 'x³', 'Cube'], ['pow', 'xⁿ', 'Power: x, then xⁿ, then n'], ['e', 'e', "Euler's number"], ['log', 'logₓy', 'Any base: base, then logₓy, then y'],
    ['sqrt', '√', 'Square root'], ['cbrt', '∛', 'Cube root'], ['root', 'ⁿ√', 'Any root: n, then ⁿ√, then x'], ['EE', 'EE', 'Times ten to the power: 6.67 EE ± 11'], ['pi', 'π', 'Pi'],
    ['angle', 'DEG', 'Degrees or radians', 'calc-key-mode'], ['C', 'C', 'Clear everything', 'calc-key-clear'], ['CE', 'CE', 'Clear this number', 'calc-key-clear'], ['DEL', 'DEL', 'Delete the last digit', 'calc-key-clear'], ['/', '÷', 'Divide', 'calc-key-op'],
    ['M', 'M', 'Recall memory', 'calc-key-mem'], ['7', '7'], ['8', '8'], ['9', '9'], ['*', '×', 'Multiply', 'calc-key-op'],
    ['M+', 'M+', 'Add to memory', 'calc-key-mem'], ['4', '4'], ['5', '5'], ['6', '6'], ['-', '−', 'Subtract', 'calc-key-op'],
    ['M-', 'M−', 'Subtract from memory', 'calc-key-mem'], ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+', 'Add', 'calc-key-op'],
    ['sign', '±', 'Change sign'], ['0', '0'], ['.', '.'], ['=', '=', 'Equals', 'calc-key-equals'],
  ];
  const NUMBER_KEYS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '.']);
  const KEYBOARD = {
    Enter: '=', '=': '=', Backspace: 'DEL', Delete: 'CE', c: 'C', C: 'C', '^': 'pow', ',': '.',
    '+': '+', '-': '-', '*': '*', '/': '/',
  };

  const calc = CalcEngine.create();
  let panel = null;
  let historyEl = null;
  let displayEl = null;
  let angleEl = null;
  let memoryEl = null;
  let angleKey = null;

  function render() {
    const v = calc.view();
    historyEl.textContent = v.history;
    displayEl.textContent = v.display;
    displayEl.classList.toggle('error', v.error);
    displayEl.classList.toggle('long', v.display.length > 13);
    angleEl.textContent = v.degrees ? 'DEG' : 'RAD';
    angleKey.textContent = v.degrees ? 'DEG' : 'RAD';
    memoryEl.hidden = !v.hasMemory;
  }

  function press(key) {
    calc.press(key);
    render();
  }

  function build() {
    panel = document.createElement('section');
    panel.id = 'calculator';
    panel.tabIndex = -1;
    panel.setAttribute('aria-label', 'Calculator');
    panel.innerHTML = `
      <div class="calc-head">
        <span class="calc-title">Calculator</span>
        <button type="button" class="stats-close-btn calc-close" title="Hide calculator" aria-label="Hide calculator">✕</button>
      </div>
      <div class="calc-screen">
        <div class="calc-status"><span class="calc-angle"></span><span class="calc-memory" hidden>M</span></div>
        <div class="calc-history"></div>
        <div class="calc-display" role="status" aria-live="polite"></div>
      </div>
      <div class="calc-keys"></div>`;
    const keys = panel.querySelector('.calc-keys');
    BUTTONS.forEach(([key, label, title, cls]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `calc-key ${cls || ''}`.trim();
      b.textContent = label;
      b.dataset.key = key;
      b.tabIndex = -1;
      if (title) { b.title = title; b.setAttribute('aria-label', title); }
      keys.appendChild(b);
    });
    historyEl = panel.querySelector('.calc-history');
    displayEl = panel.querySelector('.calc-display');
    angleEl = panel.querySelector('.calc-angle');
    memoryEl = panel.querySelector('.calc-memory');
    angleKey = panel.querySelector('[data-key="angle"]');

    keys.addEventListener('click', (e) => {
      const b = e.target.closest('.calc-key');
      if (b) press(b.dataset.key);
      panel.focus({ preventScroll: true });
    });
    panel.querySelector('.calc-close').addEventListener('click', () => setOpen(false));
    panel.addEventListener('keydown', onKey);
    enableDragging(panel.querySelector('.calc-head'));
    document.body.appendChild(panel);
    render();
  }

  function onKey(e) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = NUMBER_KEYS.has(e.key) ? e.key : KEYBOARD[e.key];
    if (!key) return;
    e.preventDefault();
    e.stopPropagation();
    press(key);
  }

  function clampToScreen() {
    const r = panel.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), Math.max(8, innerWidth - r.width - 8));
    const top = Math.min(Math.max(8, r.top), Math.max(8, innerHeight - r.height - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
  }

  function enableDragging(handle) {
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = r.left;
      startTop = r.top;
      handle.setPointerCapture(e.pointerId);
      panel.classList.add('dragging');
    });
    handle.addEventListener('pointermove', (e) => {
      if (!handle.hasPointerCapture(e.pointerId)) return;
      panel.style.left = `${startLeft + e.clientX - startX}px`;
      panel.style.top = `${startTop + e.clientY - startY}px`;
      panel.style.right = 'auto';
      clampToScreen();
    });
    const stop = () => panel.classList.remove('dragging');
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  function setOpen(open) {
    if (!panel) build();
    panel.classList.toggle('open', open);
    document.getElementById('calcToggleBtn').classList.toggle('active', open);
    if (open) {
      clampToScreen();
      panel.focus({ preventScroll: true });
    }
  }

  window.toggleCalculator = () => setOpen(!(panel && panel.classList.contains('open')));
  window.addEventListener('resize', () => { if (panel) clampToScreen(); });
})();
