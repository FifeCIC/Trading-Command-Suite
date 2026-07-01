---
description: "Build a persistent Stock Investigation system — news, price context, analyst sentiment, and findings stored to DB so investigations survive sessions and build institutional knowledge. Use when: investigating a stock move, doing due diligence, or building a research journal that compounds over time."
argument-hint: "Symbol to investigate?"
---
Build a persistent Stock Investigation system. Every investigation stores its findings — no more "evaporating" research.

## The Problem

Today's MSTR investigation pattern:
```
1. Fetch news → read headlines → form opinion
2. Fetch quote → note price context
3. Fetch analyst data → check consensus
4. Move on → ALL DATA EVAPORATES
```

Next session: same stock, same investigation, same API calls, same token cost. Zero compounding knowledge.

## The Solution: StockInvestigation Table + InvestigationService

### Schema
```prisma
model StockInvestigation {
  id              String   @id @default(uuid()) @db.VarChar(36)
  symbol          String   @db.VarChar(20)
  trigger         String   @db.VarChar(100)  // 'price_drop_10pct', 'earnings_soon', 'manual'
  priceAtTime     Float
  priceChangePct  Float?
  analystConsensus String? @db.VarChar(50)   // '93% bullish (68 analysts)'
  keyFindings     Json                        // [{source, headline, relevance, sentiment}]
  summary         String   @db.Text           // Agent's conclusion
  actionItems     Json                        // [{action, promptRef, priority}]
  newsCount       Int      @default(0)
  sources         Json                        // ['finnhub', 'alphavantage', 'fmp']
  status          String   @default('open') @db.VarChar(20)  // 'open', 'monitoring', 'closed'
  followedUpAt    DateTime?
  outcome         String?  @db.Text           // What happened next (filled on follow-up)
  investigatedAt  DateTime @default(now())

  @@index([symbol, investigatedAt])
  @@index([status])
}
```

### InvestigationService
`nest/src/modules/research/investigation.service.ts`:

```typescript
@Injectable()
export class InvestigationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finnhub: FinnhubAdapter,
    private readonly alphaVantage: AlphaVantageAdapter,
  ) {}

  async investigate(symbol: string, trigger: string): Promise<StockInvestigation> {
    // 1. Gather all data in parallel
    const [quote, news, analyst, earnings] = await Promise.allSettled([
      this.alphaVantage.getQuote(symbol),
      this.finnhub.getNews(symbol, 3),
      this.finnhub.getRecommendations(symbol),
      this.alphaVantage.getEarningsCalendar(symbol, 3),
    ]);

    const price = quote.status === 'fulfilled' ? quote.value?.last : null;
    const priceChange = quote.status === 'fulfilled' ? null : null; // from quote

    // 2. Process news — extract key headlines
    const articles = news.status === 'fulfilled' ? (news.value ?? []) : [];
    const keyFindings = articles.slice(0, 10).map((a: any) => ({
      source: a.source,
      headline: a.headline,
      datetime: a.datetime,
      relevance: this.assessRelevance(a, symbol),
      sentiment: a.sentiment ?? null,
    }));

    // 3. Analyst snapshot
    const recs = analyst.status === 'fulfilled' ? (analyst.value ?? []) : [];
    const latest = recs[0];
    const analystSnapshot = latest 
      ? `${Math.round(((latest.strongBuy + latest.buy) / 
          (latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell)) * 100)}% bullish (${latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell} analysts)`
      : null;

    // 4. Generate summary from headlines
    const summary = this.summarizeFindings(keyFindings, priceChange, symbol);

    // 5. Generate action items (prompts)
    const actionItems = this.generateActionItems(symbol, trigger, keyFindings);

    // 6. Store
    return this.prisma.stockInvestigation.create({
      data: {
        symbol,
        trigger,
        priceAtTime: price ?? 0,
        priceChangePct: priceChange,
        analystConsensus: analystSnapshot,
        keyFindings,
        summary,
        actionItems,
        newsCount: articles.length,
        sources: ['finnhub', 'alphavantage'],
        status: 'open',
      },
    });
  }

  /**
   * Follow up on a previous investigation — compare then vs now.
   */
  async followUp(investigationId: string): Promise<FollowUpResult> {
    const prev = await this.prisma.stockInvestigation.findUnique({
      where: { id: investigationId },
    });
    if (!prev) throw new Error('Investigation not found');

    // Run fresh investigation
    const current = await this.investigate(prev.symbol, 'follow_up');

    // Compare
    const quote = await this.alphaVantage.getQuote(prev.symbol);
    const priceChange = quote?.last ? quote.last - prev.priceAtTime : null;
    const daysSince = (Date.now() - prev.investigatedAt.getTime()) / 86400000;

    const outcome = priceChange !== null
      ? `${prev.symbol} ${priceChange >= 0 ? 'up' : 'down'} $${Math.abs(priceChange).toFixed(2)} (${((priceChange / prev.priceAtTime) * 100).toFixed(1)}%) over ${daysSince.toFixed(0)} days since investigation`
      : null;

    await this.prisma.stockInvestigation.update({
      where: { id: prev.id },
      data: { status: 'closed', followedUpAt: new Date(), outcome },
    });

    return { previous: prev, current, priceChange, outcome };
  }

  private assessRelevance(article: any, symbol: string): 'high' | 'medium' | 'low' {
    const headline = (article.headline || '').toLowerCase();
    const sym = symbol.toLowerCase();
    if (headline.includes(sym)) return 'high';
    if (headline.includes('bitcoin') || headline.includes('crypto')) return 'medium';
    return 'low';
  }

  private generateActionItems(symbol: string, trigger: string, findings: any[]): any[] {
    const items = [];
    
    if (trigger.includes('price_drop') || trigger.includes('pct')) {
      items.push({
        action: 'Review position sizing',
        promptRef: 'portfolio-risk-check',
        priority: 'high',
      });
    }
    
    items.push({
      action: 'Schedule follow-up',
      promptRef: null,
      priority: 'medium',
      note: `Re-investigate ${symbol} in 7 days to compare`,
    });

    return items;
  }
}
```

### API

```typescript
@Controller('research')
export class ResearchController {
  
  @Post('investigate/:symbol')
  async investigate(
    @Param('symbol') symbol: string,
    @Query('trigger') trigger = 'manual',
  ) {
    return this.investigationService.investigate(symbol, trigger);
  }

  @Get('investigation/:id')
  async getInvestigation(@Param('id') id: string) {
    return this.prisma.stockInvestigation.findUnique({ where: { id } });
  }

  @Get('investigations/:symbol')
  async getHistory(@Param('symbol') symbol: string) {
    return this.prisma.stockInvestigation.findMany({
      where: { symbol },
      orderBy: { investigatedAt: 'desc' },
    });
  }

  @Post('investigation/:id/follow-up')
  async followUp(@Param('id') id: string) {
    return this.investigationService.followUp(id);
  }
}
```

## Usage

```bash
# Investigate a stock (triggers on price drop)
curl -X POST "http://localhost:3201/api/research/investigate/MSTR?trigger=price_drop_12pct"

# Returns:
{
  "id": "inv-abc-123",
  "symbol": "MSTR",
  "trigger": "price_drop_12pct",
  "priceAtTime": 116.56,
  "summary": "MSTR dropped 12.4% intraday driven by Bitcoin weakness and dilution concerns...",
  "keyFindings": [
    {"source": "Yahoo", "headline": "Strategy's Preferred Stock Hits All-Time Low", "relevance": "high"},
    {"source": "Yahoo", "headline": "MSTR Buys $100M Bitcoin As Dilution Debate Gets Louder", "relevance": "high"}
  ],
  "actionItems": [
    {"action": "Review position sizing", "promptRef": "portfolio-risk-check", "priority": "high"}
  ],
  "investigatedAt": "2026-06-18T10:30:00Z"
}

# Follow up next week
curl -X POST "http://localhost:3201/api/research/investigation/inv-abc-123/follow-up"
```

## The Compounding Effect

After 10 investigations:
```
SELECT symbol, trigger, summary, outcome, investigatedAt 
FROM StockInvestigation 
ORDER BY investigatedAt DESC;
```

You have a research journal. Every investigation builds on the last. Zero repeated API calls for the same stock's story.

## Related
- `trading-session-init.prompt.md` — should auto-trigger investigation when daily change > 10%
- `portfolio-session-tracking.prompt.md` — price deltas trigger investigations
