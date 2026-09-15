#!/usr/bin/env python
"""
test_filling_modes.py — #824 regression guard for the MT5 order filling mode.
============================================================================
Run:  python scripts/mt5-bridge/test_filling_modes.py

WHY THIS FILE EXTRACTS THE FUNCTION INSTEAD OF IMPORTING IT
-----------------------------------------------------------
`mt5_bridge_v2.py` is a SCRIPT, not a module: importing it loads dotenv, opens a
RotatingFileHandler on `bridge.log` and prints to stdout. Doing that from a test
could rotate a log the running bridge is still writing, and it needs the
MetaTrader5 package present. So the pure policy function is pulled out of the
source by AST and executed in isolation — no side effects, no MT5, no server.

That constraint is also a design rule: `pick_filling_name` must stay free of the
MT5 API and of module state. If it ever starts reaching outside itself, this test
fails loudly rather than silently importing half a bridge.
"""

# ⚠️ Output is deliberately ASCII-ONLY. Python on Windows defaults stdout to cp1252, so a
# tick/cross/arrow glyph raises UnicodeEncodeError the moment stdout is redirected or piped
# (measured 2026-09-15). A test that cannot print its result is worse than no test.

import ast
import pathlib
import sys

BRIDGE = pathlib.Path(__file__).with_name('mt5_bridge_v2.py')
SOURCE = BRIDGE.read_text(encoding='utf-8')

failures = []


def check(name, got, want):
    ok = got == want
    print(f"  {'PASS' if ok else 'FAIL'}  {name}: {got!r}" + ('' if ok else f"  (want {want!r})"))
    if not ok:
        failures.append(name)


# ── 1. Load just the pure policy function ────────────────────────────────
tree = ast.parse(SOURCE)
fn = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'pick_filling_name'), None)
if fn is None:
    print('FAIL  pick_filling_name not found in mt5_bridge_v2.py')
    sys.exit(1)

sandbox = {}
exec(compile(ast.Module(body=[fn], type_ignores=[]), '<pick_filling_name>', 'exec'), sandbox)
pick_filling_name = sandbox['pick_filling_name']

# ── 2. The decision table ───────────────────────────────────────────────
# mask 1 = SYMBOL_FILLING_FOK, mask 2 = SYMBOL_FILLING_IOC.
print('pick_filling_name(mask)')
check('mask 0 (neither flag) -> RETURN', pick_filling_name(0), 'RETURN')
check('mask 1 (FOK only)     -> FOK', pick_filling_name(1), 'FOK')
check('mask 2 (IOC only)     -> IOC', pick_filling_name(2), 'IOC')
check('mask 3 (both)         -> IOC wins', pick_filling_name(3), 'IOC')
check('mask 4 (unknown flag) -> RETURN', pick_filling_name(4), 'RETURN')

# The 2026-09-15 failure was a symbol the broker would not FOK. If that symbol
# reports IOC, we must now choose IOC — never fall through to the FOK default.
print('\n#824 scenario')
check('broker allows only IOC -> not FOK', pick_filling_name(2), 'IOC')

# ── 3. Every market (DEAL) request must carry a filling mode ────────────
# This is the guard for instance N+1: adding a new TRADE_ACTION_DEAL path
# without calling apply_filling() fails here.
print('\nstructural invariant')
deal_requests = SOURCE.count("'action': mt5.TRADE_ACTION_DEAL")
apply_calls = SOURCE.count('apply_filling(') - 1  # minus the `def` itself
check('market (DEAL) request sites', deal_requests, 5)
check('apply_filling() call sites', apply_calls, deal_requests)

print()
if failures:
    print(f'FAILED ({len(failures)}): {", ".join(failures)}')
    sys.exit(1)
print('OK - all filling-mode checks passed')
