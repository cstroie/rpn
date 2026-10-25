/*
 * HP-style RPN calculator core.
 *
 * Four-level stack (X, Y, Z, T) with classic stack-lift semantics:
 *  - ENTER copies X into Y and disables lift, so the next digit overwrites X.
 *  - Operations enable lift, so the next digit pushes the result up.
 *  - CLX zeroes X and disables lift.
 * DOM-free so it can be tested under Node.
 */
(function (root) {
    'use strict';

    class CalcError extends Error {}
    function fail(msg) { throw new CalcError(msg); }

    const MAX_UNDO = 100;
    const MAX_DIGITS = 12;
    const MAX_TAPE = 200;
    const MAX_PROGRAM = 400;
    const MAX_RUN_STEPS = 200000;

    /** Truncate to a signed 32-bit integer (programmer modes). */
    const int32 = v => Math.trunc(v) | 0;

    function factorial(n) {
        if (n < 0 || !Number.isInteger(n)) fail('Invalid input');
        if (n > 170) fail('Overflow');
        let r = 1;
        for (let i = 2; i <= n; i++) r *= i;
        return r;
    }

    class RPN {
        constructor() {
            this.reset();
            this.angle = 'DEG';
            this.disp = { mode: 'STD', n: 4 };
            this.base = 10;
            this.program = [];
            this.recording = false;
            this.tape = [];
        }

        reset() {
            this.x = 0; this.y = 0; this.z = 0; this.t = 0;
            this.lastX = 0;
            this.regs = new Array(10).fill(0);
            this.entry = null;      // digits being typed into X, or null
            this.lift = false;
            this.error = null;
            this.pending = null;    // STO/RCL/FIX/SCI/ENG/LBL/GTO waiting for a digit
            this.undoStack = [];
            this.stat = { n: 0, sx: 0, sx2: 0 };
        }

        // ---- persistence / undo ---------------------------------------------

        snapshot() {
            return {
                x: this.x, y: this.y, z: this.z, t: this.t,
                lastX: this.lastX, regs: this.regs.slice(),
                entry: this.entry, lift: this.lift, angle: this.angle,
                stat: { ...this.stat }, disp: { ...this.disp }, base: this.base
            };
        }

        restore(s) {
            Object.assign(this, s, { regs: s.regs.slice(), stat: { ...s.stat }, disp: { ...s.disp } });
        }

        serialize() {
            const s = this.snapshot();
            s.entry = null;
            s.program = this.program;
            return JSON.stringify(s);
        }

        load(json) {
            try {
                const s = JSON.parse(json);
                const nums = ['x', 'y', 'z', 't', 'lastX'];
                if (!nums.every(k => typeof s[k] === 'number') || !Array.isArray(s.regs)) return false;
                const base = this.snapshot();
                this.restore({
                    ...base, ...s, entry: null,
                    regs: s.regs.slice(0, 10).map(Number),
                    stat: s.stat && typeof s.stat.n === 'number' ? s.stat : base.stat,
                    disp: s.disp && ['STD', 'FIX', 'SCI', 'ENG'].includes(s.disp.mode) ? s.disp : base.disp,
                    base: [2, 8, 10, 16].includes(s.base) ? s.base : 10
                });
                if (Array.isArray(s.program)) this.program = s.program.slice(0, MAX_PROGRAM).filter(st => st && typeof st.k === 'string');
                return true;
            } catch (e) {
                return false;
            }
        }

        /**
         * Run a state-changing action with undo and error handling.
         * On error the state is rolled back and the message shown.
         */
        act(fn, label) {
            this.error = null;
            const before = this.snapshot();
            const typed = this.entry;
            try {
                fn();
                if (this.base !== 10) this.x = int32(this.x);
                for (const v of [this.x, this.y, this.z, this.t]) {
                    if (!isFinite(v)) fail(isNaN(v) ? 'Invalid input' : 'Overflow');
                }
                this.undoStack.push(before);
                if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
                if (label) this.log(label, typed);
            } catch (e) {
                if (!(e instanceof CalcError)) throw e;
                this.restore(before);
                this.entry = null;
                this.error = e.message;
            }
        }

        /** Paper tape: the number that was typed (if any), then the operation and result. */
        log(label, typed) {
            if (typed !== null && typed !== undefined && typed !== '') this.tape.push({ num: typed });
            this.tape.push({ op: label, x: this.format(this.x) });
            if (this.tape.length > MAX_TAPE) this.tape.splice(0, this.tape.length - MAX_TAPE);
        }

        clearTape() { this.tape = []; }

        undo() {
            this.error = null;
            this.pending = null;
            const s = this.undoStack.pop();
            if (s) this.restore(s);
        }

        // ---- stack primitives -----------------------------------------------

        push(v) {
            this.t = this.z; this.z = this.y; this.y = this.x; this.x = v;
        }

        drop() {
            this.y = this.z; this.z = this.t;
        }

        /** Finish digit entry so X holds the typed number. */
        commit() {
            this.entry = null;
        }

        /** Put a new value in X, lifting the stack if lift is enabled. */
        recall(v) {
            this.commit();
            if (this.lift) this.push(v); else this.x = v;
            this.lift = true;
        }

        // ---- digit entry ----------------------------------------------------

        startEntry() {
            if (this.entry === null) {
                if (this.lift) this.push(0);
                this.entry = '';
                this.lift = true;
            }
        }

        parseEntry() {
            let s = this.entry;
            if (s === '' || s === '-') return 0;
            if (this.base !== 10) return int32(parseInt(s, this.base) || 0);
            if (/E-?$/.test(s)) s = s.replace(/E-?$/, '');
            const v = parseFloat(s);
            return isNaN(v) ? 0 : v;
        }

        digit(d) {
            if (this.pending) return this.register(Number(d));
            d = String(d).toUpperCase();
            if (parseInt(d, 16) >= this.base) return;
            this.act(() => {
                this.startEntry();
                const [mant, exp] = this.entry.split('E');
                if (exp !== undefined) {
                    if (exp.replace('-', '').length >= 3) return;
                } else if (mant.replace(/[-.]/g, '').length >= (this.base === 2 ? 32 : this.base === 10 ? MAX_DIGITS : 11)) {
                    return;
                }
                this.entry = (this.entry === '0' ? '' : this.entry === '-0' ? '-' : this.entry) + d;
                this.x = this.parseEntry();
            });
        }

        point() {
            if (this.base !== 10) return;
            this.act(() => {
                this.startEntry();
                if (this.entry.includes('.') || this.entry.includes('E')) return;
                this.entry += this.entry === '' || this.entry === '-' ? '0.' : '.';
            });
        }

        eex() {
            if (this.base !== 10) return;
            this.act(() => {
                this.startEntry();
                if (this.entry.includes('E')) return;
                if (this.entry === '' || this.entry === '-') this.entry += '1';
                this.entry += 'E';
                this.x = this.parseEntry();
            });
        }

        chs() {
            this.act(() => {
                if (this.entry === null) {
                    this.x = -this.x;
                    return;
                }
                const i = this.entry.indexOf('E');
                if (i >= 0) {
                    const exp = this.entry.slice(i + 1);
                    this.entry = this.entry.slice(0, i + 1) + (exp.startsWith('-') ? exp.slice(1) : '-' + exp);
                } else {
                    this.entry = this.entry.startsWith('-') ? this.entry.slice(1) : '-' + this.entry;
                }
                this.x = this.parseEntry();
            });
        }

        backspace() {
            if (this.error) { this.error = null; return; }
            if (this.entry === null) return this.clx();
            this.act(() => {
                this.entry = this.entry.slice(0, -1);
                if (this.entry === '' || this.entry === '-') {
                    this.entry = null;
                    this.x = 0;
                    this.lift = false;
                } else {
                    this.x = this.parseEntry();
                }
            });
        }

        // ---- stack operations -----------------------------------------------

        enter() {
            this.act(() => {
                this.commit();
                this.push(this.x);
                this.lift = false;
            }, 'ENTER');
        }

        clx() {
            this.act(() => {
                this.commit();
                this.x = 0;
                this.lift = false;
            }, 'CLX');
        }

        clearAll() {
            this.act(() => {
                this.commit();
                this.x = this.y = this.z = this.t = 0;
                this.lastX = 0;
                this.lift = false;
            }, 'CLR');
        }

        swap() {
            this.act(() => {
                this.commit();
                [this.x, this.y] = [this.y, this.x];
                this.lift = true;
            }, 'x↔y');
        }

        rollDown() {
            this.act(() => {
                this.commit();
                [this.x, this.y, this.z, this.t] = [this.y, this.z, this.t, this.x];
                this.lift = true;
            }, 'R↓');
        }

        rollUp() {
            this.act(() => {
                this.commit();
                [this.x, this.y, this.z, this.t] = [this.t, this.x, this.y, this.z];
                this.lift = true;
            }, 'R↑');
        }

        lastx() { this.act(() => this.recall(this.lastX), 'LASTx'); }

        constant(v, label = this.opLabel) { this.act(() => this.recall(v), label); }

        // ---- arithmetic -----------------------------------------------------

        /** Two-argument operation: consumes X and Y, result in X. */
        binary(fn, label = this.opLabel) {
            this.act(() => {
                this.commit();
                const r = fn(this.y, this.x);
                this.lastX = this.x;
                this.x = r;
                this.drop();
                this.lift = true;
            }, label);
        }

        /** One-argument operation on X. */
        unary(fn, label = this.opLabel) {
            this.act(() => {
                this.commit();
                const r = fn(this.x);
                this.lastX = this.x;
                this.x = r;
                this.lift = true;
            }, label);
        }

        /** Percent: X becomes X% of Y, Y is kept. */
        percent() {
            this.act(() => {
                this.commit();
                this.lastX = this.x;
                this.x = this.y * this.x / 100;
                this.lift = true;
            }, '%');
        }

        toRad(v) { return this.angle === 'DEG' ? v * Math.PI / 180 : v; }
        fromRad(v) { return this.angle === 'DEG' ? v * 180 / Math.PI : v; }

        /** sin/cos/tan, with exact results at multiples of 90 degrees. */
        trig(fn) {
            return v => {
                const r = fn(this.toRad(v));
                if (Math.abs(r) < 1e-15) return 0;
                if (fn === Math.tan && Math.abs(r) > 1e15) fail('Invalid input');
                return Math.abs(r - Math.round(r)) < 1e-15 ? Math.round(r) : r;
            };
        }

        op(name) {
            const add = (y, x) => y + x;
            const ops = {
                '+': () => this.binary(add),
                '-': () => this.binary((y, x) => y - x),
                '*': () => this.binary((y, x) => y * x),
                '/': () => this.binary((y, x) => { if (x === 0) fail('Divide by zero'); return y / x; }),
                'pow': () => this.binary((y, x) => {
                    if (y === 0 && x < 0) fail('Divide by zero');
                    if (y < 0 && !Number.isInteger(x)) fail('Invalid input');
                    return Math.pow(y, x);
                }),
                'root': () => this.binary((y, x) => {
                    if (x === 0) fail('Invalid input');
                    if (y < 0) {
                        if (Math.abs(x % 2) !== 1) fail('Invalid input');
                        return -Math.pow(-y, 1 / x);
                    }
                    return Math.pow(y, 1 / x);
                }),
                '%': () => this.percent(),
                'sqrt': () => this.unary(x => { if (x < 0) fail('Invalid input'); return Math.sqrt(x); }),
                'sq': () => this.unary(x => x * x),
                'inv': () => this.unary(x => { if (x === 0) fail('Divide by zero'); return 1 / x; }),
                'fact': () => this.unary(factorial),
                'ln': () => this.unary(x => { if (x <= 0) fail('Invalid input'); return Math.log(x); }),
                'exp': () => this.unary(Math.exp),
                'log': () => this.unary(x => { if (x <= 0) fail('Invalid input'); return Math.log10(x); }),
                'pow10': () => this.unary(x => Math.pow(10, x)),
                'sin': () => this.unary(this.trig(Math.sin)),
                'cos': () => this.unary(this.trig(Math.cos)),
                'tan': () => this.unary(this.trig(Math.tan)),
                'asin': () => this.unary(x => { if (Math.abs(x) > 1) fail('Invalid input'); return this.fromRad(Math.asin(x)); }),
                'acos': () => this.unary(x => { if (Math.abs(x) > 1) fail('Invalid input'); return this.fromRad(Math.acos(x)); }),
                'atan': () => this.unary(x => this.fromRad(Math.atan(x))),
                'abs': () => this.unary(Math.abs),
                'pi': () => this.constant(Math.PI)
            };
            Object.assign(ops, {
                'and': () => this.binary((y, x) => int32(y) & int32(x)),
                'or': () => this.binary((y, x) => int32(y) | int32(x)),
                'xor': () => this.binary((y, x) => int32(y) ^ int32(x)),
                'not': () => this.unary(x => ~int32(x)),
                'shl': () => this.unary(x => int32(x) << 1),
                'shr': () => this.unary(x => int32(x) >> 1),
                'mod': () => this.binary((y, x) => { if (x === 0) fail('Divide by zero'); return y - x * Math.floor(y / x); })
            });
            if (!ops[name]) throw new Error('Unknown op ' + name);
            this.opLabel = OP_LABELS[name] || name.toUpperCase();
            ops[name]();
            this.opLabel = null;
        }

        toggleAngle() {
            this.angle = this.angle === 'DEG' ? 'RAD' : 'DEG';
        }

        // ---- display and number base ----------------------------------------

        std() { this.disp = { mode: 'STD', n: this.disp.n }; }

        setBase(b) {
            this.act(() => {
                this.commit();
                this.base = b;
                if (b !== 10) {
                    this.x = int32(this.x); this.y = int32(this.y);
                    this.z = int32(this.z); this.t = int32(this.t);
                }
            }, { 16: 'HEX', 10: 'DEC', 8: 'OCT', 2: 'BIN' }[b]);
        }

        /** Format a value using the display mode and number base. */
        format(v) {
            if (this.base !== 10) {
                const u = int32(v) >>> 0;
                const s = (int32(v) < 0 && this.base !== 16 && this.base !== 2 ? '-' + Math.abs(int32(v)).toString(this.base) : u.toString(this.base)).toUpperCase();
                return s + { 16: 'h', 8: 'o', 2: 'b' }[this.base];
            }
            return formatDisplay(v, this.disp);
        }

        // ---- statistics -----------------------------------------------------

        sigma(sign) {
            this.act(() => {
                this.commit();
                const st = this.stat;
                st.n += sign;
                st.sx += sign * this.x;
                st.sx2 += sign * this.x * this.x;
                this.lastX = this.x;
                this.x = st.n;
                this.lift = false;
            }, sign > 0 ? 'Σ+' : 'Σ−');
        }

        mean() {
            this.act(() => {
                if (this.stat.n < 1) fail('No data');
                this.recall(this.stat.sx / this.stat.n);
            }, 'x̄');
        }

        sdev() {
            this.act(() => {
                const { n, sx, sx2 } = this.stat;
                if (n < 2) fail('Need 2 values');
                this.recall(Math.sqrt(Math.max(0, (sx2 - sx * sx / n) / (n - 1))));
            }, 's');
        }

        clearStats() {
            this.act(() => { this.commit(); this.stat = { n: 0, sx: 0, sx2: 0 }; }, 'CLΣ');
        }

        // ---- prefix keys waiting for a digit ----------------------------------

        prefix(name) { this.error = null; this.pending = this.pending === name ? null : name; }
        sto() { this.prefix('STO'); }
        rcl() { this.prefix('RCL'); }
        cancelPending() { this.pending = null; }

        register(n) {
            const mode = this.pending;
            this.pending = null;
            if (this.recording) return this.record({ k: mode.toLowerCase(), v: n });
            this.execStep({ k: mode.toLowerCase(), v: n });
        }

        // ---- keystroke programming ------------------------------------------

        /**
         * Single entry point for keys. While recording, steps are stored
         * instead of executed. A step is {k, v}: k is 'digit', 'op', 'act'
         * (a method name) or a prefixed key like 'sto' with a digit in v.
         */
        key(step) {
            if (step.k === 'digit' && this.pending) return this.register(Number(step.v));
            if (this.pending && step.k !== 'prefix') this.pending = null;
            if (step.k === 'prefix') return this.prefix(step.v);
            if (this.recording && !NOT_RECORDED.has(step.v)) return this.record(step);
            this.execStep(step);
        }

        record(step) {
            if (this.program.length >= MAX_PROGRAM) { this.error = 'Program full'; return; }
            this.program.push(step);
        }

        togglePrgm() {
            this.pending = null;
            this.error = null;
            this.recording = !this.recording;
            if (this.recording) this.commit();
        }

        clearProgram() { this.program = []; }

        deleteStep() { this.program.pop(); }

        execStep(step) {
            switch (step.k) {
                case 'digit': return this.digit(step.v);
                case 'op': return this.op(step.v);
                case 'act': return this[step.v]();
                case 'sto': return this.act(() => { this.commit(); this.regs[step.v] = this.x; this.lift = true; }, 'STO ' + step.v);
                case 'rcl': return this.act(() => this.recall(this.regs[step.v]), 'RCL ' + step.v);
                case 'fix': case 'sci': case 'eng':
                    this.disp = { mode: step.k.toUpperCase(), n: step.v };
                    return;
                case 'lbl': case 'gto': case 'test': case 'rs':
                    return; // only meaningful inside a running program
                default: throw new Error('Unknown step ' + step.k);
            }
        }

        /** Run the program from the top until R/S or the end. */
        run() {
            if (!this.program.length) { this.error = 'No program'; return; }
            this.commit();
            const prog = this.program;
            let pc = 0;
            for (let count = 0; pc < prog.length; count++) {
                if (count > MAX_RUN_STEPS) { this.error = 'Too many steps'; return; }
                const step = prog[pc++];
                if (step.k === 'rs') break;
                if (step.k === 'lbl') continue;
                if (step.k === 'gto') {
                    const target = prog.findIndex(s => s.k === 'lbl' && s.v === step.v);
                    if (target < 0) { this.error = `No label ${step.v}`; return; }
                    pc = target + 1;
                    continue;
                }
                if (step.k === 'test') {
                    this.commit();
                    if (!TESTS[step.v](this.x, this.y)) pc++;  // false: skip the next step
                    continue;
                }
                this.execStep(step);
                if (this.error) {
                    this.error += ` (step ${pc})`;
                    return;
                }
            }
            this.commit();
        }
    }

    const NOT_RECORDED = new Set(['togglePrgm', 'clearProgram', 'deleteStep', 'undo', 'run', 'clearTape']);

    const TESTS = {
        'x=0': x => x === 0,
        'x≠0': x => x !== 0,
        'x>0': x => x > 0,
        'x<0': x => x < 0,
        'x=y': (x, y) => x === y,
        'x≤y': (x, y) => x <= y,
        'x>y': (x, y) => x > y
    };

    const OP_LABELS = {
        '+': '+', '-': '−', '*': '×', '/': '÷', pow: 'yˣ', root: 'ˣ√y', sqrt: '√x', sq: 'x²', inv: '1/x',
        fact: 'n!', ln: 'LN', exp: 'eˣ', log: 'LOG', pow10: '10ˣ', sin: 'SIN', cos: 'COS', tan: 'TAN',
        asin: 'SIN⁻¹', acos: 'COS⁻¹', atan: 'TAN⁻¹', abs: 'ABS', pi: 'π', '%': '%',
        and: 'AND', or: 'OR', xor: 'XOR', not: 'NOT', shl: 'SL', shr: 'SR', mod: 'MOD'
    };

    /** Human-readable label for a program step. */
    function stepLabel(step) {
        switch (step.k) {
            case 'digit': return step.v;
            case 'op': return OP_LABELS[step.v] || step.v.toUpperCase();
            case 'act': return ACT_LABELS[step.v] || step.v;
            case 'test': return step.v + '?';
            case 'rs': return 'R/S';
            default: return step.k.toUpperCase() + ' ' + step.v;
        }
    }

    const ACT_LABELS = {
        enter: 'ENTER', chs: 'CHS', eex: 'EEX', point: '.', backspace: '⌫', clx: 'CLX', clearAll: 'CLR',
        swap: 'x↔y', rollDown: 'R↓', rollUp: 'R↑', lastx: 'LASTx', toggleAngle: 'DEG/RAD',
        mean: 'x̄', sdev: 's', clearStats: 'CLΣ', sigmaPlus: 'Σ+', sigmaMinus: 'Σ−', std: 'STD',
        hex: 'HEX', dec: 'DEC', oct: 'OCT', bin: 'BIN'
    };

    // Named actions so every key can be a recordable {k: 'act', v: name} step
    Object.assign(RPN.prototype, {
        sigmaPlus() { this.sigma(1); },
        sigmaMinus() { this.sigma(-1); },
        hex() { this.setBase(16); },
        dec() { this.setBase(10); },
        oct() { this.setBase(8); },
        bin() { this.setBase(2); }
    });

    /** Format with FIX / SCI / ENG / STD display settings. */
    function formatDisplay(v, disp) {
        if (!disp || disp.mode === 'STD') return format(v);
        const n = disp.n;
        const abs = Math.abs(v);
        if (disp.mode === 'FIX' && (v === 0 || (abs >= 1e-10 && abs < 1e12))) {
            const s = v.toFixed(n);
            if (Number(s) !== 0 || v === 0) return s;
        }
        // toExponential rounds correctly from the exact decimal value
        const [m, e] = v.toExponential(n).split('e');
        const exp = Number(e);
        if (disp.mode !== 'ENG') return m + 'E' + exp;
        // ENG: move the decimal point so the exponent is a multiple of 3
        const shift = ((exp % 3) + 3) % 3;
        const sign = m.startsWith('-') ? '-' : '';
        const digits = m.replace('-', '').replace('.', '').padEnd(shift + 1, '0');
        const frac = digits.slice(shift + 1);
        return sign + digits.slice(0, shift + 1) + (frac ? '.' + frac : '') + 'E' + (exp - shift);
    }

    /** Format a number for a 12-digit display. */
    function format(v) {
        if (v === 0) return '0';
        const abs = Math.abs(v);
        if (abs >= 1e-9 && abs < 1e12) {
            let s = v.toPrecision(12);
            if (s.includes('e')) s = String(parseFloat(s));
            if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
            return s.replace('e', 'E');
        }
        const [m, e] = v.toExponential(9).split('e');
        return m.replace(/\.?0+$/, '') + 'E' + Number(e);
    }

    /** Display text for X: the raw entry while typing, otherwise formatted. */
    function displayX(calc) {
        return calc.entry !== null ? (calc.entry || '0') : calc.format(calc.x);
    }

    const api = { RPN, CalcError, format, formatDisplay, displayX, stepLabel, TESTS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RPNCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
