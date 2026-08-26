import { MacdCrossoverDirective } from './src/modules/directives/implementations/macd-crossover.directive';
import { macd } from './src/modules/directives/utils/indicators';

const d = new MacdCrossoverDirective();

function makeBars(closes: number[]): any[] {
  return closes.map((close, i) => ({
    timestamp: new Date(Date.now() - (closes.length - i) * 3600000),
    open: close * 0.999,
    high: close * 1.005,
    low: close * 0.995,
    close,
    volume: 1000000,
  }));
}

function trial(name: string, closes: number[]) {
  const { histogram } = macd(closes, 12, 26, 9);
  const n = histogram.length;
  const cur = histogram[n - 1];
  const prev = histogram[n - 2];
  const r = d.calculate({ symbol: 'TEST', bars: makeBars(closes) });
  const last4 = histogram.slice(-4).map((h) => h.toFixed(2)).join(', ');
  console.log(
    `${name}: lastHist=[${last4}] freshCross=${prev <= 0 && cur > 0} score=${r.score} conf=${r.confidence}`
  );
}

const decline = Array.from({ length: 40 }, (_, i) => 100 - i * 1.25); // 100 → 51.25
trial('singleBar', [...decline, 85]);
trial('singleHuge', [...decline, 110]);
trial('twoBarBig', [...decline, 60, 90]);
trial('twoBarHuge', [...decline, 65, 105]);
trial('threeBar', [...decline, 58, 72, 95]);
