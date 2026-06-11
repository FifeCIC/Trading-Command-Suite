import { Test, TestingModule } from '@nestjs/testing';
import { StrategiesService } from './strategies.service';
import { ModeService } from '../../config/mode.service';

describe('StrategiesService', () => {
  let service: StrategiesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StrategiesService,
        {
          provide: ModeService,
          useValue: { getModeInfo: () => ({ mode: 'test', database: false, queue: false, redis: false }) },
        },
      ],
    }).compile();

    service = module.get<StrategiesService>(StrategiesService);
  });

  describe('calculateScore', () => {
    const CANONICAL_WEIGHTS = [
      { directiveId: 'rsi-oversold', weight: 24 },
      { directiveId: 'macd-crossover', weight: 22 },
      { directiveId: 'ema-structure', weight: 20 },
      { directiveId: 'atr-dip', weight: 18 },
      { directiveId: 'volume-confirmation', weight: 16 },
    ];

    it('should compute weighted average with canonical weights', () => {
      const results = new Map([
        ['rsi-oversold', { score: 80, confidence: 0.9, reason: 'RSI curling up' }],
        ['macd-crossover', { score: 70, confidence: 0.8, reason: 'MACD crossing' }],
        ['ema-structure', { score: 90, confidence: 0.85, reason: 'EMA aligned' }],
        ['atr-dip', { score: 50, confidence: 0.6, reason: 'Moderate dip' }],
        ['volume-confirmation', { score: 60, confidence: 0.7, reason: 'Volume OK' }],
      ]);

      const result = service.calculateScore(
        'sym-1', 'AAPL', results, CANONICAL_WEIGHTS, '1h',
      );

      // Expected: (80*24/100) + (70*22/100) + (90*20/100) + (50*18/100) + (60*16/100)
      // = 19.2 + 15.4 + 18.0 + 9.0 + 9.6 = 71.2
      expect(result.totalScore).toBe(71.2);
      expect(result.confidence).toBeCloseTo(0.784, 2);
      expect(result.breakdown).toHaveLength(5);
      expect(result.guidance).toContain('Entry signal');
      expect(result.strategyId).toBe('conviction-dip-accumulation');
    });

    it('should cap score at 100', () => {
      const results = new Map([
        ['rsi-oversold', { score: 100, confidence: 1.0, reason: 'Max' }],
        ['macd-crossover', { score: 100, confidence: 1.0, reason: 'Max' }],
        ['ema-structure', { score: 100, confidence: 1.0, reason: 'Max' }],
        ['atr-dip', { score: 100, confidence: 1.0, reason: 'Max' }],
        ['volume-confirmation', { score: 100, confidence: 1.0, reason: 'Max' }],
      ]);

      const result = service.calculateScore(
        'sym-2', 'NVDA', results, CANONICAL_WEIGHTS, '1h',
      );

      expect(result.totalScore).toBe(100);
      expect(result.guidance).toContain('Entry signal');
    });

    it('should floor score at 0', () => {
      const results = new Map([
        ['rsi-oversold', { score: -10, confidence: 0.1, reason: 'Bad' }],
        ['macd-crossover', { score: -5, confidence: 0.1, reason: 'Bad' }],
        ['ema-structure', { score: -20, confidence: 0.1, reason: 'Bad' }],
        ['atr-dip', { score: -15, confidence: 0.1, reason: 'Bad' }],
        ['volume-confirmation', { score: -8, confidence: 0.1, reason: 'Bad' }],
      ]);

      const result = service.calculateScore(
        'sym-3', 'TSLA', results, CANONICAL_WEIGHTS, '1h',
      );

      expect(result.totalScore).toBe(0);
      expect(result.guidance).toContain('Active concern');
    });

    it('should skip missing directives with a warning', () => {
      // Only 3 out of 5 directives provided
      const results = new Map([
        ['rsi-oversold', { score: 80, confidence: 0.9, reason: 'RSI' }],
        ['macd-crossover', { score: 70, confidence: 0.8, reason: 'MACD' }],
        ['volume-confirmation', { score: 60, confidence: 0.7, reason: 'Volume' }],
      ]);

      const result = service.calculateScore(
        'sym-4', 'MSFT', results, CANONICAL_WEIGHTS, '1h',
      );

      // Only 3 directives: (80*24 + 70*22 + 60*16) / 100 = (1920 + 1540 + 960) / 100 = 44.2
      // weight used for confidence: 24 + 22 + 16 = 62
      expect(result.breakdown).toHaveLength(3);
      expect(result.totalScore).toBe(44.2);
      // Guidance should be watchlist (44.2 >= 40)
      expect(result.guidance).toContain('Watchlist');
    });

    it('should handle empty results', () => {
      const result = service.calculateScore(
        'sym-5', 'AMD', new Map(), CANONICAL_WEIGHTS, '1h',
      );

      expect(result.totalScore).toBe(0);
      expect(result.confidence).toBe(0);
      expect(result.breakdown).toHaveLength(0);
      expect(result.guidance).toContain('Active concern');
    });

    it('should return correct timeframe and timestamp', () => {
      const results = new Map([
        ['rsi-oversold', { score: 50, confidence: 0.5, reason: 'Neutral' }],
      ]);

      const result = service.calculateScore(
        'sym-6', 'GOOG', results, [{ directiveId: 'rsi-oversold', weight: 100 }], '4h',
      );

      expect(result.timeframe).toBe('4h');
      expect(result.timestamp).toBeTruthy();
      expect(() => new Date(result.timestamp)).not.toThrow();
    });
  });
});
