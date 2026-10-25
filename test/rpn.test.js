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
