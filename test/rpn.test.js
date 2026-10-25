'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RPN, format, displayX } = require('../rpn.js');

/**
 * Press keys on a fresh calculator. Digits, '.', 'EEX', 'CHS', 'ENTER',
 * 'BS', 'CLX', 'SWAP', 'RDN', 'LASTX', 'UNDO', 'STO', 'RCL', 'ANGLE' are
 * keys; anything else is an op name. Multi-digit numbers are split.
 */
function press(keys, calc = new RPN()) {
    const actions = {
        '.': c => c.point(), EEX: c => c.eex(), CHS: c => c.chs(), ENTER: c => c.enter(),
        BS: c => c.backspace(), CLX: c => c.clx(), SWAP: c => c.swap(), RDN: c => c.rollDown(),
        LASTX: c => c.lastx(), UNDO: c => c.undo(), STO: c => c.sto(), RCL: c => c.rcl(),
        ANGLE: c => c.toggleAngle()
    };
    for (const k of keys.trim().split(/\s+/)) {
        if (/^\d+$/.test(k)) for (const d of k) calc.digit(d);
        else if (actions[k]) actions[k](calc);
        else calc.op(k);
    }
    return calc;
}

const x = keys => format(press(keys).x);

test('binary operations drop the stack', () => {
    const c = press('2 ENTER 3 +');
    assert.equal(c.x, 5);
    assert.equal(c.y, 0);
    assert.equal(x('3 ENTER 4 * 5 +'), '17');
});

test('T register is copied down on drop', () => {
    const c = press('1 ENTER 2 ENTER 3 ENTER 4 + + +');
    assert.equal(c.x, 10);
    assert.equal(c.y, 1);
});

test('ENTER duplicates X', () => {
    assert.equal(x('7 ENTER *'), '49');
});

test('stack lift after an operation', () => {
    assert.equal(x('9 sqrt 2 +'), '5');
});

test('CLX disables lift', () => {
    assert.equal(x('2 ENTER 3 CLX 5 +'), '7');
});

test('digit entry, backspace, EEX and CHS', () => {
    assert.equal(x('1 2 BS 5'), '15');
    assert.equal(x('1 . 5 EEX 3'), '1500');
    assert.equal(x('1 EEX 3 CHS'), '0.001');
    assert.equal(x('5 CHS ENTER 3 +'), '-2');
    assert.equal(displayX(press('1 . 5 EEX 3')), '1.5E3');
});

test('errors leave the stack untouched', () => {
    const c = press('1 ENTER 0 /');
    assert.equal(c.error, 'Divide by zero');
    assert.equal(c.x, 0);
    assert.equal(c.y, 1);
    assert.equal(press('1 EEX 308 ENTER *').error, 'Overflow');
    assert.equal(press('1 CHS sqrt').error, 'Invalid input');
});

test('scientific functions', () => {
    assert.equal(x('2 ENTER 10 pow'), '1024');
    assert.equal(x('27 ENTER 3 root'), '3');
    assert.equal(x('6 fact'), '720');
    assert.equal(x('100 log'), '2');
    assert.equal(x('50 ENTER 10 %'), '5');
});

test('trigonometry is exact at special angles', () => {
    assert.equal(x('30 sin'), '0.5');
    assert.equal(x('90 cos'), '0');
    assert.equal(x('ANGLE pi sin'), '0');
    assert.equal(x('1 atan'), '45');
});

test('swap, roll down, LAST x', () => {
    assert.equal(x('2 ENTER 3 SWAP -'), '1');
    const r = press('1 ENTER 2 ENTER 3 ENTER 4 RDN');
    assert.deepEqual([r.x, r.y, r.z, r.t], [3, 2, 1, 4]);
    const l = press('4 ENTER 5 + LASTX');
    assert.deepEqual([l.x, l.y], [5, 9]);
});

test('STO and RCL registers', () => {
    assert.equal(x('4 STO 3 CLX 1 RCL 3 +'), '5');
});

test('undo restores the previous state', () => {
    const c = press('4 ENTER 5 + UNDO');
    assert.deepEqual([c.x, c.y], [5, 4]);
});

test('serialize and load round trip', () => {
    const a = press('1 ENTER 2 ENTER 3 STO 7');
    const b = new RPN();
    assert.ok(b.load(a.serialize()));
    assert.deepEqual([b.x, b.y, b.z, b.regs[7]], [3, 2, 1, 3]);
    assert.equal(new RPN().load('not json'), false);
});

test('number formatting', () => {
    assert.equal(format(1 / 3), '0.333333333333');
    assert.equal(format(0.1 + 0.2), '0.3');
    assert.equal(format(1e100), '1E100');
    assert.equal(format(-2.5e-12), '-2.5E-12');
});

const { formatDisplay, stepLabel } = require('../rpn.js');

test('FIX, SCI and ENG display modes', () => {
    assert.equal(formatDisplay(Math.PI, { mode: 'FIX', n: 4 }), '3.1416');
    assert.equal(formatDisplay(-2.5, { mode: 'FIX', n: 2 }), '-2.50');
    assert.equal(formatDisplay(1234.5, { mode: 'SCI', n: 3 }), '1.235E3');
    assert.equal(formatDisplay(0.000123, { mode: 'SCI', n: 2 }), '1.23E-4');
    assert.equal(formatDisplay(12345, { mode: 'ENG', n: 3 }), '12.35E3');
    assert.equal(formatDisplay(0.0047, { mode: 'ENG', n: 2 }), '4.70E-3');
    assert.equal(formatDisplay(9.9999, { mode: 'SCI', n: 2 }), '1.00E1');
    assert.equal(formatDisplay(1e-15, { mode: 'FIX', n: 2 }), '1.00E-15');
    const c = new RPN();
    c.key({ k: 'prefix', v: 'FIX' });
    c.key({ k: 'digit', v: '2' });
    assert.deepEqual(c.disp, { mode: 'FIX', n: 2 });
    c.digit('1'); c.digit('0'); c.op('/') ;
    assert.equal(c.format(1 / 3), '0.33');
});

test('programmer mode: bases and bitwise operations', () => {
    const c = new RPN();
    c.hex();
    for (const d of 'FF') c.digit(d);
    c.enter();
    c.digit('0'); c.digit('F');
    c.op('and');
    assert.equal(c.x, 15);
    assert.equal(displayX(c), 'Fh');
    c.op('not');
    assert.equal(displayX(c), 'FFFFFFF0h');
    c.bin();
    c.clx(); c.digit('1'); c.digit('0'); c.digit('2');  // 2 is not a binary digit
    assert.equal(c.x, 2);
    c.dec();
    c.digit('7'); c.enter(); c.digit('2'); c.op('/');
    assert.equal(c.x, 3.5);
    c.oct();
    assert.equal(displayX(c), '3o');
});

test('statistics: Σ+, mean, standard deviation, Σ−', () => {
    const c = new RPN();
    for (const v of ['2', '4', '4', '4', '5', '5', '7', '9']) { c.digit(v); c.sigmaPlus(); }
    assert.equal(c.x, 8);
    c.mean();
    assert.equal(c.x, 5);
    c.sdev();
    assert.equal(format(c.x), '2.1380899353');
    c.digit('9'); c.sigmaMinus();
    assert.equal(c.x, 7);
    c.clearStats();
    c.mean();
    assert.equal(c.error, 'No data');
});

test('paper tape records numbers, operations and results', () => {
    const c = new RPN();
    press('12 ENTER 3 +', c);
    assert.deepEqual(c.tape, [
        { num: '12' }, { op: 'ENTER', x: '12' },
        { num: '3' }, { op: '+', x: '15' }
    ]);
    c.clearTape();
    assert.equal(c.tape.length, 0);
});

test('keystroke programs record and run', () => {
    const c = new RPN();
    c.togglePrgm();
    // Program: square X and add 1
    c.key({ k: 'act', v: 'enter' });
    c.key({ k: 'op', v: '*' });
    c.key({ k: 'digit', v: '1' });
    c.key({ k: 'op', v: '+' });
    c.togglePrgm();
    assert.deepEqual(c.program.map(stepLabel), ['ENTER', '×', '1', '+']);
    c.digit('7');
    c.run();
    assert.equal(c.x, 50);
});

test('programs with labels, GTO and conditional tests loop', () => {
    // Sum 1..10 using register 0 as the counter and register 1 as the total
    const c = new RPN();
    const steps = [
        { k: 'digit', v: '1' }, { k: 'digit', v: '0' }, { k: 'sto', v: 0 },
        { k: 'digit', v: '0' }, { k: 'sto', v: 1 },
        { k: 'lbl', v: 1 },
        { k: 'rcl', v: 0 }, { k: 'test', v: 'x=0' }, { k: 'rs' },
        { k: 'rcl', v: 1 }, { k: 'op', v: '+' }, { k: 'sto', v: 1 },
        { k: 'digit', v: '1' }, { k: 'rcl', v: 0 }, { k: 'act', v: 'swap' }, { k: 'op', v: '-' }, { k: 'sto', v: 0 },
        { k: 'gto', v: 1 }
    ];
    c.togglePrgm();
    for (const st of steps) c.key(st.k === 'sto' || st.k === 'rcl' || st.k === 'lbl' || st.k === 'gto'
        ? { k: 'prefix', v: st.k.toUpperCase() } : st) || (['sto', 'rcl', 'lbl', 'gto'].includes(st.k) && c.key({ k: 'digit', v: String(st.v) }));
    c.togglePrgm();
    assert.equal(c.program.length, steps.length);
    c.run();
    assert.equal(c.error, null);
    assert.equal(c.regs[1], 55);
});

test('runaway programs stop with an error', () => {
    const c = new RPN();
    c.program = [{ k: 'lbl', v: 0 }, { k: 'gto', v: 0 }];
    c.run();
    assert.equal(c.error, 'Too many steps');
});

test('program, display mode and base survive serialize/load', () => {
    const a = new RPN();
    a.program = [{ k: 'op', v: 'sqrt' }];
    a.disp = { mode: 'SCI', n: 3 };
    const b = new RPN();
    b.load(a.serialize());
    assert.deepEqual(b.program, a.program);
    assert.deepEqual(b.disp, a.disp);
});
