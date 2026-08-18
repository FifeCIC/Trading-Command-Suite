/**
 * SuitabilityService — static protocol/symbol metadata join (#646).
 *
 * A suitability filter answers ONE question: "does this symbol structurally fit
 * any protocol?" It is a PURE, static check — no directive evaluation, no market
 * data, no bars, no scores. It is the handover gate into a watchlist.
 *
 * Attention ≠ conviction: suitability only decides whether a symbol could be
 * watched under a protocol. Directional conviction happens later, after handover,
 * via the existing scoring engine.
 */
import { Injectable } from '@nestjs/common';

export interface SymbolSuitabilityDescriptor {
  ticker: string;
  /** stock | crypto | forex | index | commodity | etf — undefined = unknown */
  type?: string;
  /** true/false — undefined = unknown (treated as "no constraint violated") */
  shortable?: boolean;
}

export interface ProtocolSuitabilityDescriptor {
  slug: string;
  name?: string | null;
  directionMode?: string | null; // LONG_ONLY | SHORT_ONLY | BOTH
  /** If non-empty, the protocol only fits these symbol types. */
  symbolTypes?: string[];
  recommendedTimeframe?: string | null;
  tradingStyle?: string | null;
}

export interface SuitabilityVerdict {
  protocolSlug: string;
  protocolName: string;
  fits: boolean;
  /** Exclusion reasons when !fits; informational notes when fits. */
  reasons: string[];
  direction: 'LONG' | 'SHORT' | 'BOTH';
}

@Injectable()
export class SuitabilityService {
  /**
   * Evaluate one symbol against one protocol.
   * Pure — no I/O, no directives, no market data.
   */
  evaluateOne(symbol: SymbolSuitabilityDescriptor, protocol: ProtocolSuitabilityDescriptor): SuitabilityVerdict {
    const directionMode = (protocol.directionMode || 'LONG_ONLY').toUpperCase();
    const direction: SuitabilityVerdict['direction'] =
      directionMode === 'SHORT_ONLY' ? 'SHORT' : directionMode === 'BOTH' ? 'BOTH' : 'LONG';

    const reasons: string[] = [];
    let fits = true;

    // 1. Direction contract — a SHORT_ONLY protocol needs a short-suitable symbol.
    //    Absence of data (shortable === undefined) is NOT a violation: the symbol
    //    may still be surfaced (attention) and resolved later.
    if (directionMode === 'SHORT_ONLY') {
      if (symbol.shortable === false) {
        fits = false;
        reasons.push('not short-suitable (SHORT_ONLY protocol)');
      } else if (symbol.shortable === undefined) {
        reasons.push('shortability unknown — treated as suitable');
      }
    }

    // 2. Symbol type — only enforced when the protocol declares expectations AND
    //    the symbol's type is known. Unknown type never excludes.
    const declaredTypes = protocol.symbolTypes && protocol.symbolTypes.length > 0 ? protocol.symbolTypes : null;
    if (declaredTypes && symbol.type) {
      const t = symbol.type.toLowerCase();
      if (!declaredTypes.map((x) => x.toLowerCase()).includes(t)) {
        fits = false;
        reasons.push(`symbol type ${symbol.type} not in [${declaredTypes.join(', ')}]`);
      }
    }

    // 3. Timeframe — informational only. Suitability is pre-data; a symbol can be
    //    watched on any timeframe regardless of the protocol's preference.
    if (protocol.recommendedTimeframe) {
      reasons.push(`recommended timeframe ${protocol.recommendedTimeframe}`);
    }

    return {
      protocolSlug: protocol.slug,
      protocolName: protocol.name || protocol.slug,
      fits,
      reasons,
      direction,
    };
  }

  /** Evaluate one symbol against many protocols. */
  evaluateAll(symbol: SymbolSuitabilityDescriptor, protocols: ProtocolSuitabilityDescriptor[]): SuitabilityVerdict[] {
    return protocols.map((p) => this.evaluateOne(symbol, p));
  }

  /**
   * Static heuristic: infer the asset classes a protocol targets from its slug /
   * tradingStyle / name. Returns [] (no constraint) when nothing is recognisable.
   * This is a placeholder for a real per-protocol `symbolTypes` field if one is
   * ever added — it never blocks a symbol it is unsure about.
   */
  inferProtocolSymbolTypes(protocol: { slug?: string; name?: string | null; tradingStyle?: string | null }): string[] {
    const haystack = [protocol.slug, protocol.tradingStyle, protocol.name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    const types: string[] = [];
    if (/(^|[-_ ])forex|forex[-_]|eurusd|gbpusd|usdjpy|usdcad|audusd|nzdusd|usdchf|(^|[-_ ])fx([-_ ]|$)/.test(haystack)) {
      types.push('forex');
    }
    if (/crypto|btc|bitcoin|(^|[-_ ])eth([-_ ]|$)|altcoin/.test(haystack)) {
      types.push('crypto');
    }
    if (/gold|xau|silver|oil|crude|commodit|metal/.test(haystack)) {
      types.push('commodity');
    }
    if (/index|(^|[-_ ])spy([-_ ]|$)|spx|qqq|nasdaq|us500|(^|[-_ ])dow([-_ ]|$)/.test(haystack)) {
      types.push('index');
    }
    if (/stock|equity|earnings|(^|[-_ ])tech([-_ ]|$)|momentum|value|growth/.test(haystack)) {
      types.push('stock');
    }
    return types;
  }

  /**
   * Static short-suitability heuristic from symbol metadata.
   * forex/crypto are structurally shortable (a pair/CFD can always be sold).
   * Everything else is only shortable if tagged; absence of a tag = unknown.
   */
  deriveShortable(type?: string, tags?: unknown): boolean | undefined {
    if (!type) return undefined;
    const t = type.toLowerCase();
    if (t === 'forex' || t === 'crypto') return true;

    const tagList = Array.isArray(tags) ? tags.map((x) => String(x).toLowerCase()) : [];
    if (tagList.some((x) => ['shortable', 'short', 'short-enabled'].includes(x))) return true;
    if (tagList.some((x) => ['no-short', 'long-only'].includes(x))) return false;
    return undefined;
  }
}
