import { resolveDirectiveCatalog } from './strategies.controller';

describe('resolveDirectiveCatalog', () => {
  it('resolves directives from protocol metadata when the selector is a protocol slug', async () => {
    const prisma = {
      strategy: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      protocol: {
        findUnique: jest.fn().mockResolvedValue({
          slug: 'btc-speed-v1',
          name: 'BTC Investment Monitor V1',
          directiveGroups: [
            {
              groupId: 'technical',
              name: 'Technical',
              sortOrder: 0,
              directives: [{ directiveId: 'rsi-oversold', maxScore: 120 }],
            },
          ],
        }),
      },
    };

    const directivesService = {
      get: jest.fn().mockReturnValue({ name: 'RSI Oversold', maxScore: 120 }),
    };

    const protocolDb = {
      findBySlug: jest.fn().mockResolvedValue(undefined),
    };

    const result = await resolveDirectiveCatalog({
      identifier: 'btc-speed-v1',
      prisma: prisma as any,
      directivesService: directivesService as any,
      protocolDb: protocolDb as any,
    });

    expect(result.strategyName).toBe('BTC Investment Monitor V1');
    expect(result.directives).toHaveLength(1);
    expect(result.directives[0]).toMatchObject({
      id: 'rsi-oversold',
      // Protocol-derived catalogs format the slug via formatDirectiveName()
      // ('rsi-oversold' → 'Rsi Oversold') — NOT the directivesService name.
      name: 'Rsi Oversold',
      active: true,
    });
  });
});
