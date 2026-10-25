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
        }

        reset() {
            this.x = 0; this.y = 0; this.z = 0; this.t = 0;
            this.lastX = 0;
            this.regs = new Array(10).fill(0);
            this.entry = null;      // digits being typed into X, or null
            this.lift = false;
            this.error = null;
            this.pending = null;    // 'STO' | 'RCL' waiting for a register digit
            this.undoStack = [];
        }

        // ---- persistence / undo ---------------------------------------------

        snapshot() {
            return {
                x: this.x, y: this.y, z: this.z, t: this.t,
                lastX: this.lastX, regs: this.regs.slice(),
                entry: this.entry, lift: this.lift, angle: this.angle
            };
        }

        restore(s) {
            Object.assign(this, s, { regs: s.regs.slice() });
        }

        serialize() {
            const s = this.snapshot();
            s.entry = null;
            return JSON.stringify(s);
        }

        load(json) {
            try {
                const s = JSON.parse(json);
                const nums = ['x', 'y', 'z', 't', 'lastX'];
                if (!nums.every(k => typeof s[k] === 'number') || !Array.isArray(s.regs)) return false;
                this.restore({ ...this.snapshot(), ...s, entry: null, regs: s.regs.slice(0, 10).map(Number) });
                return true;
            } catch (e) {
                return false;
            }
        }

        /**
         * Run a state-changing action with undo and error handling.
         * On error the state is rolled back and the message shown.
         */
        act(fn) {
            this.error = null;
            const before = this.snapshot();
            try {
                fn();
                for (const v of [this.x, this.y, this.z, this.t]) {
                    if (!isFinite(v)) fail(isNaN(v) ? 'Invalid input' : 'Overflow');
                }
                this.undoStack.push(before);
                if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
            } catch (e) {
                if (!(e instanceof CalcError)) throw e;
                this.restore(before);
                this.entry = null;
                this.error = e.message;
            }
        }

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
            if (/E-?$/.test(s)) s = s.replace(/E-?$/, '');
            const v = parseFloat(s);
            return isNaN(v) ? 0 : v;
        }

        digit(d) {
            if (this.pending) return this.register(Number(d));
            this.act(() => {
                this.startEntry();
                const [mant, exp] = this.entry.split('E');
                if (exp !== undefined) {
                    if (exp.replace('-', '').length >= 3) return;
                } else if (mant.replace(/[-.]/g, '').length >= MAX_DIGITS) {
                    return;
                }
                this.entry = (this.entry === '0' ? '' : this.entry === '-0' ? '-' : this.entry) + d;
                this.x = this.parseEntry();
            });
        }

        point() {
            this.act(() => {
                this.startEntry();
                if (this.entry.includes('.') || this.entry.includes('E')) return;
                this.entry += this.entry === '' || this.entry === '-' ? '0.' : '.';
            });
        }

        eex() {
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
            });
        }

        clx() {
            this.act(() => {
                this.commit();
                this.x = 0;
                this.lift = false;
            });
        }

        clearAll() {
            this.act(() => {
                this.commit();
                this.x = this.y = this.z = this.t = 0;
                this.lastX = 0;
                this.lift = false;
            });
        }

        swap() {
            this.act(() => {
                this.commit();
                [this.x, this.y] = [this.y, this.x];
                this.lift = true;
            });
        }

        rollDown() {
            this.act(() => {
                this.commit();
                [this.x, this.y, this.z, this.t] = [this.y, this.z, this.t, this.x];
                this.lift = true;
            });
        }

        rollUp() {
            this.act(() => {
                this.commit();
                [this.x, this.y, this.z, this.t] = [this.t, this.x, this.y, this.z];
                this.lift = true;
            });
        }

        lastx() { this.act(() => this.recall(this.lastX)); }

        constant(v) { this.act(() => this.recall(v)); }

        // ---- arithmetic -----------------------------------------------------

        /** Two-argument operation: consumes X and Y, result in X. */
        binary(fn) {
            this.act(() => {
                this.commit();
                const r = fn(this.y, this.x);
                this.lastX = this.x;
                this.x = r;
                this.drop();
                this.lift = true;
            });
        }

        /** One-argument operation on X. */
        unary(fn) {
            this.act(() => {
                this.commit();
                const r = fn(this.x);
                this.lastX = this.x;
                this.x = r;
                this.lift = true;
            });
        }

        /** Percent: X becomes X% of Y, Y is kept. */
        percent() {
            this.act(() => {
                this.commit();
                this.lastX = this.x;
                this.x = this.y * this.x / 100;
                this.lift = true;
            });
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
            if (!ops[name]) throw new Error('Unknown op ' + name);
            ops[name]();
        }

        toggleAngle() {
            this.angle = this.angle === 'DEG' ? 'RAD' : 'DEG';
        }

        // ---- memory registers -----------------------------------------------

        sto() { this.error = null; this.pending = this.pending === 'STO' ? null : 'STO'; }
        rcl() { this.error = null; this.pending = this.pending === 'RCL' ? null : 'RCL'; }
        cancelPending() { this.pending = null; }

        register(n) {
            const mode = this.pending;
            this.pending = null;
            if (mode === 'STO') {
                this.act(() => { this.commit(); this.regs[n] = this.x; this.lift = true; });
            } else {
                this.act(() => this.recall(this.regs[n]));
            }
        }
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
        return calc.entry !== null ? (calc.entry || '0') : format(calc.x);
    }

    const api = { RPN, CalcError, format, displayX };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RPNCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
