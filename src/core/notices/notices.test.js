/**
 * notices.test.js — the registry's invariants, run without a browser.
 * =================================================================
 * Created 2026-09-15 for #826 **Phase 6**. Run with: `npm run test:notices`
 *
 * WHY A TEST AND NOT A REVIEW
 * ---------------------------
 * Phase 6's acceptance criterion is "translation is demonstrable: one locale added without touching
 * a single call site". A demonstration in a chat message proves it once, for one code, on one day.
 * These assertions prove it for **every** code, on every run — and each one is a property that was
 * silently broken at least once in this app's history:
 *
 *   1. **A code renders every field.** An entry whose `message` is `{detail}` renders as the raw
 *      detail with no frame; one with a typo'd placeholder renders `{detial}` to a user.
 *   2. **No message is blank.** The anti-silence rule: a blank notice is worse than an ugly one.
 *   3. **An unknown code names itself.** `known: false` is a signal to a developer, and the code
 *      must still be visible to a user reporting it.
 *   4. **The same code renders in every locale**, with the code unchanged — the identity survives
 *      translation, which is the only reason a support ticket can be grepped (this is exactly what
 *      failed in #824: the user was shown the broker's prose and nothing else).
 *   5. **A partial locale falls back per FIELD, not per code.** The property that makes a locale
 *      shipable incrementally, and the one most likely to be "simplified" away.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTICES,
  AREAS,
  SEVERITIES,
  notice,
  noticeLine,
  renderTemplate,
  listNotices,
  isNoticeCode,
  setNoticeLocale,
  getNoticeLocale,
} from './registry.js';
import { AVAILABLE_LOCALES, applyNoticeLocale, registerBundledLocales } from './apply-locale.js';
import { tradeFailureNotice } from './trade-result.js';
import de from './locales/de.js';

const CODES = Object.keys(NOTICES);

/** Every declared param given a value, so any template that still has `{x}` is using an undeclared one. */
const allParams = (code) =>
  Object.fromEntries((NOTICES[code].params || []).map((p) => [p, `«${p}»`]));

test('the catalogue is well formed', () => {
  assert.ok(CODES.length > 0, 'registry is empty');

  for (const code of CODES) {
    const def = NOTICES[code];
    const [, area] = code.match(/^TCS-([A-Z]{2,6})-\d{3}$/) ?? [];
    assert.equal(def.area, area, `${code}: area does not match the code segment`);
    assert.ok(SEVERITIES.includes(def.severity), `${code}: unknown severity ${def.severity}`);
    assert.ok(AREAS[def.area], `${code}: area ${def.area} is not declared`);
    assert.equal(new Set(def.params).size, def.params.length, `${code}: duplicate params`);
    assert.ok(isNoticeCode(code), `${code}: isNoticeCode disagrees with the catalogue`);
  }
});

test('every code renders a title, a message and a non-empty line', () => {
  for (const code of CODES) {
    const n = notice(code, allParams(code));
    assert.equal(n.known, true, `${code}: reported as unknown`);
    assert.ok(n.title?.trim(), `${code}: blank title`);
    assert.ok(n.message?.trim(), `${code}: blank message`);
    assert.ok(noticeLine(code, allParams(code)).includes(`[${code}]`), `${code}: line lacks the code`);
  }
});

test('no template leaks an unsubstituted placeholder when its params are supplied', () => {
  for (const code of CODES) {
    for (const locale of AVAILABLE_LOCALES.map((l) => l.id)) {
      applyNoticeLocale(locale);
      const n = notice(code, allParams(code));
      for (const field of ['title', 'message', 'cause', 'action']) {
        const text = n[field];
        if (!text) continue;
        assert.ok(
          !/\{\w+\}/.test(text),
          `${code} [${locale}]: ${field} still shows a placeholder — "${text}"`,
        );
      }
    }
  }
  applyNoticeLocale('en');
});

test('an undeclared placeholder is left VISIBLE rather than blanked (anti-silence)', () => {
  assert.equal(renderTemplate('about {symbol}', {}), 'about {symbol}');
  // An empty string counts as missing: "rejected " reads like a rendering bug, "rejected {symbol}" reports itself.
  assert.equal(renderTemplate('about {symbol}', { symbol: '' }), 'about {symbol}');
  assert.equal(renderTemplate('about {symbol}', { symbol: 'XAGUSD' }), 'about XAGUSD');
});

test('an unknown code is never blank and names itself', () => {
  // Built at runtime so the identifier cannot be mistaken for a real registration by the gate.
  const bogus = ['TCS', 'SYS', '000'].join('-');
  const n = notice(bogus);
  assert.equal(n.known, false);
  assert.ok(n.message.includes(bogus), 'the unknown code must appear in its own message');
  assert.ok(n.severity && n.title, 'an unknown code still has to present');
});

test('the SAME code renders in every locale — only the wording differs', () => {
  registerBundledLocales();
  const code = 'TCS-TRADE-001';
  const params = allParams(code);

  applyNoticeLocale('en');
  const english = notice(code, params);
  applyNoticeLocale('de');
  const german = notice(code, params);
  applyNoticeLocale('en');

  assert.equal(german.code, english.code, 'the code must not translate');
  assert.equal(german.severity, english.severity, 'severity is metadata, not wording');
  assert.equal(german.area, english.area, 'area is metadata, not wording');
  assert.notEqual(german.title, english.title, 'the German title should differ from the English one');
  // Params are substituted identically in both languages — that is what makes the code the interface.
  assert.ok(german.message.includes('«symbol»'), 'the German message must substitute the same params');
  assert.ok(english.message.includes('«symbol»'), 'the English message must substitute the same params');
});

test('a partial locale falls back PER FIELD, not per code', () => {
  registerBundledLocales();
  // TCS-SIG-001 is translated but deliberately carries no `cause` — that single field must fall
  // back to English while title/message stay German. Per-code fallback would drop the whole entry.
  applyNoticeLocale('de');
  const n = notice('TCS-SIG-001', { detail: 'HTTP 500' });
  assert.match(n.title, /Signalliste/, 'the translated title should be used');
  assert.match(n.cause, /Status|detail|HTTP/i, 'the English cause should fall back in');
  applyNoticeLocale('en');

  // And an entirely untranslated code is still English, in every field.
  applyNoticeLocale('de');
  const untouched = notice('TCS-TRADE-013', allParams('TCS-TRADE-013'));
  assert.equal(untouched.title, NOTICES['TCS-TRADE-013'].title);
  applyNoticeLocale('en');
});

test('an unrecognised locale degrades to English instead of blanking every message', () => {
  registerBundledLocales();
  assert.equal(applyNoticeLocale('kl'), 'en');
  assert.equal(getNoticeLocale(), 'en');
  assert.ok(notice('TCS-SYS-002', allParams('TCS-SYS-002')).message.length > 0);

  // Also true of a stale preference value (e.g. a locale file that was removed).
  setNoticeLocale('zz');
  assert.ok(notice('TCS-SYS-002', allParams('TCS-SYS-002')).message.length > 0);
  setNoticeLocale('en');
});

test('the German bundle only names registered codes, and its placeholders are declared', () => {
  // The gate checks this too (`validate-notices.cjs`); the duplicate here is deliberate — the gate
  // runs on prebuild, this runs on the machine of whoever edits the translation.
  for (const [code, fields] of Object.entries(de)) {
    assert.ok(NOTICES[code], `${code}: translated but not registered`);
    for (const [field, text] of Object.entries(fields)) {
      for (const [, placeholder] of String(text).matchAll(/\{(\w+)\}/g)) {
        assert.ok(
          (NOTICES[code].params || []).includes(placeholder),
          `${code}.${field}: {${placeholder}} is not declared by ${code}`,
        );
      }
    }
  }
});

test('listNotices() exposes the whole catalogue to tooling', () => {
  const listed = listNotices();
  assert.equal(listed.length, CODES.length);
  for (const n of listed) assert.ok(n.code && n.title, 'every listed notice needs a code and a title');
});
  // ── The server → client code contract (#826 Phase 1/2) ────────────────────────────────────
  //
  // These guard a defect that was found TWICE, because it lived in two card components: the
  // `success: false` path hardcoded a code and discarded the one the server had computed. The
  // symptom was correct-looking text with wrong advice attached.
  //
  // ⚠️ The second assertion is deliberately a SYMPTOM guard, not a cause guard. It does not care
  // WHY the code was dropped — only that the user is no longer told to go and read a broker
  // retcode for a refusal that never reached a broker.

  test('a trade refusal renders the SERVER code, not a hardcoded one', () => {
    // The MT5 bridge refuses when it is already holding its cap, and says so with its own code.
    const refusal = {
      success: false,
      error: 'Max open positions (5) reached — 5 currently open',
      code: 'TCS-TRADE-017',
      params: { open: 5, maximum: 5 },
    };

    const n = tradeFailureNotice(refusal, 'XAUUSD');

    assert.equal(n.code, 'TCS-TRADE-017', 'the server-supplied code must win');
    assert.equal(n.known, true);

    // ⚠️ THE REGRESSION, ASSERTED AS A SYMPTOM. TCS-TRADE-005's action tells the user to go and
    // read a BROKER RETCODE and a filling mode. A bridge position cap never contacts a broker, so
    // that advice is unactionable — it sends the user looking for something that cannot exist.
    // Reverting to a hardcoded TCS-TRADE-005 makes this assertion fail.
    assert.doesNotMatch(n.action, /retcode/i);
    assert.match(n.action, /position/i, 'the remedy must name the thing that is actually wrong');

    // The server's own sentence survives verbatim as the cause — never discarded.
    assert.equal(n.cause, 'This is a safety cap in the bridge, not a broker limit.');
  });

  test('server params are passed through, so richer codes render real values', () => {
    const n = tradeFailureNotice(
      { success: false, code: 'TCS-TRADE-017', params: { open: 7, maximum: 9 } },
      'XAUUSD',
    );
    assert.match(n.message, /7/, '{open} must come from the server, not a default');
    assert.match(n.message, /9/, '{maximum} must come from the server, not a default');
    assert.doesNotMatch(n.message, /\{/, 'no placeholder may be left unsubstituted');
  });

  test('a refusal with NO server code falls back, and keeps the server wording', () => {
    const n = tradeFailureNotice({ success: false, error: 'broker said no' }, 'XAUUSD');

    assert.equal(n.code, 'TCS-TRADE-005', 'the fallback is the only case where the cause is unknown');
    assert.equal(n.cause, 'broker said no', "the server's own sentence is never discarded");

    // The canary for the test above: the fallback code's action DOES name a retcode, which is why
    // it must not be reached when the server supplied something more specific.
    assert.match(n.action, /retcode/i);
  });

  test('a refusal with an empty result still renders a non-blank notice (anti-silence)', () => {
    for (const bad of [undefined, null, {}, { success: false }]) {
      const n = tradeFailureNotice(bad, 'XAUUSD');
      assert.ok(n && n.code, 'a notice is always returned');
      assert.ok(n.title && n.message, 'never blank, whatever the server sent');
      assert.equal(n.code, 'TCS-TRADE-005');
    }
  });

  test('no notice sends the user to a control that no longer controls anything', () => {
    // The three MT5 caps moved OUT of `.env` and into the settings registry on 2026-09-17 (#849):
    // they are now read through SettingsResolverService and applied live, with no restart.
    //
    // ⚠️ Naming the old env var is not a cosmetic problem. It is the exact defect this whole
    // registry exists to prevent — a user edits what the message named, sees no change, and
    // concludes the setting is broken. That is what happened when the position cap was raised in
    // the UI and `MT5_MAX_OPEN_POSITIONS=5` kept enforcing 5. Advice must name the LIVE control.
    const RETIRED = ['MT5_MAX_POSITION_SIZE', 'MT5_MAX_OPEN_POSITIONS', 'MT5_MAX_DAILY_LOSS'];

    for (const [code, def] of Object.entries(NOTICES)) {
      for (const field of ['title', 'message', 'cause', 'action']) {
        const text = def[field];
        if (typeof text !== 'string') continue;
        for (const env of RETIRED) {
          assert.ok(
            !text.includes(env),
            `${code}.${field} tells the user to edit ${env}, which no longer controls this`,
          );
        }
      }
    }
  });