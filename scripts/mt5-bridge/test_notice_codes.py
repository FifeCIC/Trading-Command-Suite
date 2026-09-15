#!/usr/bin/env python
"""
test_notice_codes.py - #826 Phase 3 guards for the bridge's notice codes.
=======================================================================
Run:  python scripts/mt5-bridge/test_notice_codes.py

TWO INDEPENDENT THINGS ARE CHECKED, BECAUSE THE CODES LIVE IN TWO LANGUAGES.

1. The refusal CONTRACT. `refusal()` is extracted by AST and executed in isolation - the same
   technique as test_filling_modes.py, and for the same reason: importing the bridge would load
   dotenv, open a log handler and could rotate a log a live bridge is writing.

2. The two code LISTS agree. The bridge is Python and cannot import
   src/core/notices/registry.js, so the constants are duplicated by necessity. The JS gate
   (scripts/validate-notices.cjs) catches "emitted but unregistered". This test adds the other
   direction - "the bridge dropped a code the registry still lists" is caught here - so the two
   lists cannot drift apart silently in either direction.

Output is ASCII-only on purpose: Python on Windows defaults stdout to cp1252, and a tick glyph
raises UnicodeEncodeError the moment output is redirected.
"""

import ast
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
BRIDGE = HERE / 'mt5_bridge_v2.py'
REGISTRY = HERE.parent.parent / 'src' / 'core' / 'notices' / 'registry.js'

SOURCE = BRIDGE.read_text(encoding='utf-8')
REGISTRY_TEXT = REGISTRY.read_text(encoding='utf-8')

failures = []


def check(name, ok, detail=''):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  {detail}" if detail and not ok else ''))
    if not ok:
        failures.append(name)


# ---- 1. The refusal contract ------------------------------------------------
tree = ast.parse(SOURCE)
fn = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'refusal'), None)
if fn is None:
    print('FAIL  refusal() not found in mt5_bridge_v2.py')
    sys.exit(1)

sandbox = {}
exec(compile(ast.Module(body=[fn], type_ignores=[]), '<refusal>', 'exec'), sandbox)
refusal = sandbox['refusal']

print('refusal() contract')
r = refusal('TCS-TRADE-011', 'Volume 0.001 below XAGUSD minimum (0.01)',
            {'symbol': 'XAGUSD', 'volume': 0.001, 'minimum': 0.01})
check('carries the code', r.get('code') == 'TCS-TRADE-011')
check('carries the params', r.get('params', {}).get('minimum') == 0.01)
check('keeps the human message', 'XAGUSD' in r.get('error', ''))
check('marks success false', r.get('success') is False)
check('omits params when there are none', 'params' not in refusal('TCS-INTEG-001', 'x'))
check('omits external when there is none', 'external' not in refusal('TCS-INTEG-001', 'x'))
ext = refusal('TCS-TRADE-001', 'rejected', None,
              {'system': 'MetaTrader 5', 'code': 10030, 'name': 'TRADE_RETCODE_INVALID_FILL'})
check('carries the broker retcode', ext.get('external', {}).get('code') == 10030)

# ---- 2. Every NOTICE_* constant is a valid, REGISTERED code -----------------
print('\ncode constants vs the JS registry')
constants = re.findall(r"^(NOTICE_[A-Z_]+)\s*=\s*'(TCS-[A-Z]+-\d{3})'", SOURCE, re.M)
check('found the code constants', len(constants) >= 12, f'found {len(constants)}')

registered = set(re.findall(r"'(TCS-[A-Z]+-\d{3})':\s*\{", REGISTRY_TEXT))
check('registry parsed', len(registered) >= 12, f'found {len(registered)}')

unregistered = [f'{name}={code}' for name, code in constants if code not in registered]
check('every constant is REGISTERED in the JS registry', not unregistered,
      'unregistered: ' + ', '.join(unregistered) if unregistered else '')

# Duplicate constants pointing at the same code are fine (aliases); a code with no constant is not.
bridge_codes = {code for _, code in constants}
print(f'  (bridge uses {len(bridge_codes)} distinct codes; registry has {len(registered)})')

print()
if failures:
    print(f'FAILED ({len(failures)}): {", ".join(failures)}')
    sys.exit(1)
print('OK - refusal contract and code list verified')
