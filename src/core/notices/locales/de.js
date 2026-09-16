/**
 * de — German wording for the notice registry.
 * ============================================
 * Created 2026-09-15 for #826 **Phase 6**, to exercise the locale seam for real rather than in
 * principle. This file is the proof that a translation needs NO change at a call site: the codes
 * stay identical, the params stay identical, only the sentences differ.
 *
 * WHY GERMAN
 * ----------
 * Not for German's own sake — because German is a **layout stress test**. Compound nouns and the
 * verb-final clause order make text roughly 20-30% longer than English ("Zeitüberschreitung bei der
 * Anfrage" against "Request timed out"), so it exposes fixed-width buttons, single-line tooltips and
 * truncation that a similar-length language would hide. If the notice block survives German it
 * survives most languages.
 *
 * ⚠️ THIS BUNDLE IS PARTIAL, ON PURPOSE. It translates the conditions a user is most likely to meet
 * and leaves the rest to English. That is the designed behaviour, not an unfinished job: the
 * registry overrides **field by field** (see wordingFor()), so a translator can ship a locale
 * incrementally without ever rendering an empty box. A code present here with no `cause` still shows
 * the English cause.
 *
 * WHAT A TRANSLATOR MUST NOT CHANGE
 * ---------------------------------
 * The placeholders. `{symbol}` is substituted from the call site, so a translation that renames or
 * drops one renders the literal `{symbol}` to a user — which `validate-notices.cjs` fails the build
 * for, and `notices.test.js` proves cannot happen.
 *
 * The register is formal ("Sie"), matching how a trading platform addresses an account holder.
 */

export default {
  // ── System / platform ──────────────────────────────────────────────────
  'TCS-SYS-002': {
    title: 'Anfrage fehlgeschlagen',
    message: 'Die Anfrage an die API ist fehlgeschlagen (HTTP {status}).',
    action:
      'Prüfen Sie, ob die API läuft, und versuchen Sie es erneut. Der Status benennt die Klasse: ' +
      '400 Anfrage abgelehnt, 404 nicht gefunden, 409 Konflikt, 5xx Serverfehler.',
  },
  'TCS-SYS-003': {
    title: 'Zeitüberschreitung bei der Anfrage',
    message: 'Die API hat nicht innerhalb von {seconds}s geantwortet, daher wurde die Anfrage abgebrochen.',
  },
  'TCS-SYS-004': {
    title: 'Anfrage vor der Ausführung abgelehnt',
    message: 'Die Anfrage wurde abgelehnt, bevor sie den Endpunkt erreicht hat: {count} Feld(er) sind ungültig.',
    cause: 'Abgelehnte Felder: {fields}',
  },
  'TCS-SYS-005': {
    title: 'API-Anfrage hat ihr Zeitlimit überschritten',
    message: 'Die API hat diese Anfrage nach {seconds}s ohne Ergebnis abgebrochen.',
  },
  'TCS-SYS-006': {
    title: 'Unerwarteter Serverfehler',
    message: 'Bei der Verarbeitung dieser Anfrage ist ein unerwarteter Fehler aufgetreten (HTTP {status}).',
  },

  // ── Broker / integrations ──────────────────────────────────────────────
  'TCS-INTEG-001': {
    title: 'MT5-Bridge nicht verbunden',
    message: 'Die MT5-Bridge konnte das Terminal nicht erreichen, daher wurde die Anfrage nicht gesendet.',
  },
  'TCS-INTEG-002': {
    title: 'MT5-Sicherungsschalter ist offen',
    message: 'Anfragen an MT5 sind nach wiederholten Fehlern pausiert, daher wurde die Order nicht gesendet.',
  },

  // ── Trading / execution ────────────────────────────────────────────────
  'TCS-TRADE-001': {
    title: 'Order abgelehnt — nicht unterstützter Ausführungsmodus',
    message: 'Der Broker hat {symbol} abgelehnt (filling={mode}).',
  },
  'TCS-TRADE-005': {
    title: 'Order wurde nicht platziert',
    message: 'Die Order für {symbol} wurde nicht platziert.',
  },

  // ── Risk ───────────────────────────────────────────────────────────────
  'TCS-RISK-001': {
    title: 'Trade durch ein Sicherheits-Gate blockiert',
    message: 'Der Trade wurde blockiert: {reason}',
  },

  // ── Signals ────────────────────────────────────────────────────────────
  'TCS-SIG-001': {
    title: 'Signalliste nicht verfügbar',
    message: 'Die rangierten Signale konnten nicht geladen werden.',
    // cause left out deliberately: an untranslated field falls back to English rather than
    // rendering nothing. This entry is the test fixture for that behaviour.
  },

  // ── Data ───────────────────────────────────────────────────────────────
  'TCS-DATA-001': {
    title: 'Textkodierung beschädigt (Mojibake)',
    message: '{count} Zeichenfolge(n) in {file} sind beschädigt.',
  },
  // NOTE: {symbol} and {hours} are placeholders, NOT words — they are substituted from the call
  // site. Renaming one (e.g. to {symbol_name}) renders the literal "{symbol}" to a user, and
  // validate-notices.cjs fails the build for it. Translate the sentence, never the placeholder.
  'TCS-DATA-002': {
    title: 'Überhaupt keine Bars',
    message: '{symbol} hat auf keinem Zeitrahmen Bars.',
  },
  'TCS-DATA-003': {
    title: 'Datenzufuhr gestoppt',
    message: '{symbol} hat zuletzt vor {hours} Stunden eine Bar geliefert.',
  },
  'TCS-DATA-004': {
    title: 'Aktualität der Datenzufuhr unbekannt',
    message: 'Es konnte nicht geprüft werden, welche Symbole keine Bars mehr liefern.',
  },
  'TCS-DATA-005': {
    title: 'Symbole liefern keine Bars mehr',
    message:
      '{count} bewertete(s) Symbol(e) liefern keine frischen Bars — {noData} ganz ohne Daten und ' +
      '{stopped}, die unterwegs aufgehört haben.',
  },
  'TCS-DATA-006': {
    title: 'Alle Datenzufuhren aktuell',
    message: 'Alle {count} bewerteten Symbole haben Bars innerhalb ihrer Kadenz-Toleranz.',
  },
};
