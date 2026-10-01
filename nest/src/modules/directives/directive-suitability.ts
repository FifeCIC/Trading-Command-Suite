/**
 * directive-suitability.ts — the ONE reader of `DIRECTIVE_SUITABILITY` (#1051 criterion 2).
 * ===========================================================================================
 *
 * THE FINDING
 * -----------
 * `directive-suitability.registry.ts` declares `instrumentTypes` for **109** directives and its own
 * header says it is *"Used by activation gates to determine which directives should fire under
 * current market conditions."* Measured 2026-10-01: **it was imported by nothing.** Not one file.
 * A buried ability: 109 declarations on disk, zero readers, and the comment asserting the opposite.
 *
 * ⚠️ WHY THIS MODULE READS IT BUT DOES NOT ENFORCE IT
 * --------------------------------------------------
 * Wiring `instrumentTypes` into a gate **changes what a scored symbol scores**, so it is a MATHS
 * change and the owner's rule applies (`maths-change-requires-ab.instructions.md`): create a COPIED
 * configuration and compare, never edit in place.
 *
 * Measured blast radius on the live database 2026-10-01 — **111** directive-symbol pairs would be
 * excluded:
 *
 *   | protocol            | pairs | directive                     | declared            |
 *   |---------------------|-------|-------------------------------|---------------------|
 *   | `forex-session-v1`  |  **75** | `liquidity-check`           | stocks, crypto      |
 *   |                     |       | `bollinger-band-squeeze`      | stocks, crypto      |
 *   |                     |       | `session-open-effect`         | stocks, indices     |
 *   |                     |       | `analyst-adjustments`         | stocks              |
 *   | `xau-speed-v1`      |     8 | `spy-qqq-relative-strength`   | stocks, indices     |
 *
 * **75 of 111 are the flagship forex protocol**, and the affected classes are forex (75), index
 * (17), commodity (16), crypto (3). So the rule reads *correctly* — a stocks-only directive should
 * not score a currency pair — and it would simultaneously remove four directive slots from the
 * protocol the app relies on most.
 *
 * ⚠️ **A rule that reads correctly can over-reject catastrophically, and only measurement catches
 * it.** That is the whole argument for this file existing as a READER first. Enforcement stays off
 * until a copied configuration has been compared.
 *
 * ⚠️ SEVEN DIRECTIVES ARE PLACED IN PROTOCOLS WITH **NO** REGISTRY ENTRY (47 placements). They are
 * reported by the audit and are never excluded — the default for an unknown id must be "no
 * constraint", because the alternative is excluding a directive because our table is incomplete.
 */
import { DIRECTIVE_SUITABILITY } from './directive-suitability.registry';
import { SuitabilityProfile } from './interfaces/directive.interface';

/**
 * `symbol.type` holds an ASSET CLASS with six values; the registry declares FIVE, and it uses the
 * plural. This is the only place the two vocabularies are reconciled.
 *
 * ⚠️ `etf` maps to `stocks` deliberately: an ETF is a basket of equities, and there is no `etf`
 * class in the registry. It is NOT mapped to `indices` — an index is not tradeable as a basket.
 */
export const SYMBOL_CLASS_ALIAS: Record<string, string> = {
  stock: 'stocks',
  etf: 'stocks',
  index: 'indices',
  commodity: 'commodities',
  forex: 'forex',
  crypto: 'crypto',
};

/** `symbol.type` (or anything else) → the registry's plural class, or `null` when unmappable. */
export function normaliseSymbolClass(type?: string | null): string | null {
  if (!type) return null;
  return SYMBOL_CLASS_ALIAS[String(type).toLowerCase()] ?? null;
}

export interface ClassFitVerdict {
  /** Does the directive declare this symbol's class as suitable? */
  fits: boolean;
  /** The classes the directive declares. Empty = no constraint declared. */
  declared: string[];
  /** The registry's class for the symbol, or null when the type is unmappable. */
  symbolClass: string | null;
  /** Why it does not fit — `null` when it does, or when it cannot be judged. */
  reason: string | null;
  /** The directive has no registry entry at all. Distinct from "fits". */
  unknownDirective: boolean;
}

/**
 * Does one directive fit one symbol's asset class?
 *
 * ⚠️ **Unknown NEVER excludes.** Three unknowns exist and all three return `fits: true`:
 * an unmappable symbol type, a directive with no registry entry, and a registry entry with an empty
 * `instrumentTypes`. Each is a gap in OUR data, not a property of the market — and excluding on a
 * gap is how a directive silently disappears from a protocol.
 */
export function directiveFitsSymbolClass(directiveId: string, symbolType?: string | null): ClassFitVerdict {
  const profile: SuitabilityProfile | undefined = DIRECTIVE_SUITABILITY[directiveId];
  const symbolClass = normaliseSymbolClass(symbolType);

  if (!profile) {
    return { fits: true, declared: [], symbolClass, reason: null, unknownDirective: true };
  }
  const declared = (profile.instrumentTypes || []).map((x) => String(x).toLowerCase());
  if (declared.length === 0) {
    return { fits: true, declared, symbolClass, reason: null, unknownDirective: false };
  }
  if (!symbolClass) {
    return { fits: true, declared, symbolClass, reason: null, unknownDirective: false };
  }
  if (declared.includes(symbolClass)) {
    return { fits: true, declared, symbolClass, reason: null, unknownDirective: false };
  }
  return {
    fits: false,
    declared,
    symbolClass,
    reason: `declared [${declared.join(', ')}] does not include ${symbolClass}`,
    unknownDirective: false,
  };
}

/** One placed directive, as the audit sees it. */
export interface SuitabilityPlacement {
  protocolSlug: string;
  protocolId: string;
  directiveId: string;
}
/** One symbol a protocol reaches. */
export interface SuitabilitySymbol {
  protocolId: string;
  ticker: string;
  type?: string | null;
}

export interface SuitabilityAudit {
  /** Every (placement × symbol) pair the declaration would exclude. */
  pairs: Array<{ protocolSlug: string; directiveId: string; ticker: string; symbolClass: string | null; reason: string }>;
  /** Pairs that COULD NOT be judged, so a reader can tell "none" from "not checked". */
  unknown: { unmappableSymbolClass: number; directiveNotInRegistry: number };
  totals: {
    placements: number;
    symbols: number;
    pairsConsidered: number;
    wouldExclude: number;
  };
  byDirective: Array<{ directiveId: string; declared: string[]; pairs: number }>;
  byProtocol: Array<{ protocolSlug: string; pairs: number }>;
  bySymbolClass: Array<{ symbolClass: string; pairs: number }>;
}

/**
 * auditSuitability() — the blast radius of turning the declaration into a gate.
 *
 * ⚠️ Pure: it takes the placements and symbols, so a test can drive it without a database, and the
 * script and any future endpoint share ONE implementation.
 */
export function auditSuitability(
  placements: SuitabilityPlacement[],
  symbols: SuitabilitySymbol[],
): SuitabilityAudit {
  const byProtocol = new Map<string, SuitabilitySymbol[]>();
  for (const s of symbols) {
    if (!byProtocol.has(s.protocolId)) byProtocol.set(s.protocolId, []);
    byProtocol.get(s.protocolId)!.push(s);
  }

  const pairs: SuitabilityAudit['pairs'] = [];
  const unknown = { unmappableSymbolClass: 0, directiveNotInRegistry: 0 };
  const byDirectiveMap = new Map<string, { declared: string[]; pairs: number }>();
  const byProtocolMap = new Map<string, number>();
  const byClassMap = new Map<string, number>();
  let pairsConsidered = 0;

  for (const p of placements) {
    const reach = byProtocol.get(p.protocolId) || [];
    for (const sym of reach) {
      pairsConsidered += 1;
      const verdict = directiveFitsSymbolClass(p.directiveId, sym.type);
      if (verdict.unknownDirective) { unknown.directiveNotInRegistry += 1; continue; }
      if (!verdict.symbolClass) { unknown.unmappableSymbolClass += 1; continue; }
      if (verdict.fits) continue;

      pairs.push({
        protocolSlug: p.protocolSlug,
        directiveId: p.directiveId,
        ticker: sym.ticker,
        symbolClass: verdict.symbolClass,
        reason: verdict.reason || 'declared class does not include this symbol',
      });
      const d = byDirectiveMap.get(p.directiveId) || { declared: verdict.declared, pairs: 0 };
      d.pairs += 1;
      byDirectiveMap.set(p.directiveId, d);
      byProtocolMap.set(p.protocolSlug, (byProtocolMap.get(p.protocolSlug) || 0) + 1);
      byClassMap.set(verdict.symbolClass, (byClassMap.get(verdict.symbolClass) || 0) + 1);
    }
  }

  const rank = <T>(m: Map<string, T>, n: (v: T) => number) =>
    [...m.entries()].sort((a, b) => n(b[1]) - n(a[1]));

  return {
    pairs,
    unknown,
    totals: {
      placements: placements.length,
      symbols: symbols.length,
      pairsConsidered,
      wouldExclude: pairs.length,
    },
    byDirective: rank(byDirectiveMap, (v) => v.pairs)
      .map(([directiveId, v]) => ({ directiveId, declared: v.declared, pairs: v.pairs })),
    byProtocol: rank(byProtocolMap, (v) => v)
      .map(([protocolSlug, n]) => ({ protocolSlug, pairs: n })),
    bySymbolClass: rank(byClassMap, (v) => v)
      .map(([symbolClass, n]) => ({ symbolClass, pairs: n })),
  };
}

/** How many directives the registry declares, and how many carry a real constraint. */
export function registryCoverage(): { total: number; withConstraint: number; empty: number } {
  const entries = Object.entries(DIRECTIVE_SUITABILITY);
  const withConstraint = entries.filter(([, p]) => (p.instrumentTypes || []).length > 0).length;
  return { total: entries.length, withConstraint, empty: entries.length - withConstraint };
}
