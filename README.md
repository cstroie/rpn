# RPN-4 Scientific Calculator

[![test](https://github.com/cstroie/rpn/actions/workflows/test.yml/badge.svg)](https://github.com/cstroie/rpn/actions/workflows/test.yml)

An HP-style Reverse Polish Notation calculator that runs in the browser. It has a four-level stack, classic stack-lift behaviour, scientific functions, memory registers and undo. There are no dependencies and no build step.

**Live demo: https://cstroie.github.io/rpn/**

<img src="docs/screenshot.png" alt="The RPN-4 calculator" width="360">

## RPN in one minute

Enter the numbers first, then the operation:

| Calculation | Keys |
|-------------|------|
| 2 + 3 | `2 ENTER 3 +` |
| (3 + 4) × 5 | `3 ENTER 4 + 5 ×` |
| 7² | `7 ENTER ×` |
| √(3² + 4²) | `3 SHIFT √x 4 SHIFT √x + √x` (`SHIFT √x` is x²) |

The stack behaves like an HP calculator:

- **ENTER** copies X into Y. The next digit then replaces X.
- A two-number operation uses X and Y. The stack drops: Z moves to Y, and T is copied down into Z.
- After an operation, typing a number pushes the result up into Y, so you can chain calculations.
- **CLX** zeroes X, and the next number replaces it.

## Features

- **Arithmetic:** `+ − × ÷`, `yˣ`, `ˣ√y`, `%` (X% of Y, with Y kept)
- **Functions:** `√x`, `x²`, `1/x`, `n!`, `LN`, `eˣ`, `LOG`, `10ˣ`, `SIN` / `COS` / `TAN` and their inverses in degrees or radians, `ABS`, `π`
- **Stack:** `x↔y`, `R↓`, `R↑`, `LAST x`, `CLX`, `CLR ALL`
- **Entry:** `CHS` (also flips the exponent sign while typing it), `EEX` for exponents such as `6.02 EEX 23`, and `⌫` to delete a digit
- **Memory:** `STO 0–9` and `RCL 0–9`
- **Undo:** up to 100 steps
- **Errors:** errors such as divide by zero or the square root of a negative number are shown on the display, and the stack is left unchanged.
- **Persistence:** the stack, memories and angle mode are kept between visits.
- **Clipboard:** click the display or press `Ctrl+C` to copy X. `Ctrl+V` pastes a number into X.
- **Share:** the **SHARE** button copies a link with the stack, memories and angle mode packed into the address.

Gold labels are second functions: press **SHIFT** (or `f`), then the key.

## Keyboard

| Keys | Action |
|------|--------|
| `0`–`9` `.` | digits |
| `Enter` | ENTER |
| `+ - * / ^ %` | arithmetic, yˣ, percent |
| `Backspace` | delete digit, or CLX when not typing |
| `Esc` / `Delete` | CLX / clear everything |
| `n` / `e` | CHS / EEX |
| `s` `r` `l` | x↔y, R↓, LAST x |
| `q` `i` `p` | √x, 1/x, π |
| `f` | SHIFT |
| `u` / `Ctrl+Z` | undo |

## Layout

- `rpn.js` holds the calculator engine. It does not touch the DOM and can run under Node:

  ```js
  const { RPN, format } = require('./rpn.js');
  const c = new RPN();
  c.digit('3'); c.enter(); c.digit('4'); c.op('+');
  console.log(format(c.x)); // 7
  ```
- `index.html` holds the user interface.

## Tests

```
node --test
```

The tests run the calculator engine under Node (version 18 or later) with no dependencies. GitHub Actions runs them on every push.

## License

[MIT](LICENSE) © Costin Stroie
