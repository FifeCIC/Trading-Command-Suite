# TradePress: Why I Built It (And Why You Might Want to Use It)

## Why I Built TradePress: A Story of Frustration, Ambition, and Three Monitors

Most side projects start with a problem. Mine started with *many* problems—and the stubborn belief that I could solve them better than anyone else had.

I'm a software developer by trade, a trader by necessity, and apparently a glutton for punishment by choice. For years, I bounced between trading platforms, each one promising the earth but delivering something that felt... incomplete. TradingView is phenomenal for charting, but rigid. Alpaca is powerful for automation, but lacks the analytical depth I craved. Discord bots exist for alerts, but they're scattered, disconnected, fragmented.

Then came the real frustration: I'd identify a trading opportunity, but by the time I'd cross-referenced three different tools, checked my watchlist, calculated risk, and decided on entry—the moment had passed. The tools weren't talking to each other. They weren't *thinking* with me.

So I did what any developer would do: I decided to build my own.

**TradePress wasn't born from ego.** It was born from the gap between what I needed and what existed. And after months of development, countless prototypes, 50+ admin views I created just to visualize the scope, and more log files than I care to admit, I realized something: this gap wasn't just mine. It was everyone's.

---

## The Core Concept: Scoring Directives

At the heart of TradePress is something I call **Scoring Directives**—a system that combines multiple technical indicators into a unified, weighted scoring algorithm. Think of it as teaching the plugin to think like a trader.

Instead of jumping between RSI, MACD, CCI, and volume analysis across different platforms, TradePress lets you define *how* these indicators should work together. You assign weights to each directive (30% momentum, 35% trend strength, 35% volume surge), and the plugin generates a composite score for any stock you're watching.

The beauty of this approach is adaptability. Your strategy isn't locked into a preset formula. You can adjust weights, add new directives, or test different combinations without touching code. It's trading strategy as configuration, not as a black box.

**What's working right now:**
- 22+ pre-configured directives (ADX, RSI, MACD, CCI, Bollinger Bands, EMA, Volume analysis, and more)
- Real-time scoring with intelligent API caching
- Multi-platform data integration (Alpha Vantage, Finnhub, Polygon, IEX Cloud, and 15+ others)
- Strategy builder with custom weighting
- Watchlist management with real-time score updates
- A testing framework to validate directives before you use them

This isn't vaporware. These features are live, tested, and working. You can download TradePress today and start building strategies.

---

## The AI Dilemma: How I Learned to Trust My Code

Here's something I haven't talked about publicly until now: **AI played a significant role in building TradePress, and it nearly broke the entire project.**

When I started, I used AI (primarily GitHub Copilot) to accelerate development. It was fast. Too fast. Within weeks, I hit a wall: I couldn't tell which features were running on demo data and which were pulling live API data. AI would generate interfaces so efficiently that I'd lose track of what was actually working.

The problem was subtle but critical. I'd ask AI to build a watchlist UI, and it would. But was it displaying demo data or live data? I genuinely didn't know. And if I released a feature in demo mode by accident, users would think the plugin was broken.

So I built a toggle—a global demo/live switch that would let users (and me) test features in isolation. I added clear notices on any page displaying demo data: "DEMO DATA - DO NOT TRUST FOR LIVE TRADING." Simple, right?

Except AI didn't always respect that rule. Sometimes it would use demo data where I didn't expect it. Sometimes it would mix demo and live data in the same view. And despite my explicit instructions, it would occasionally add the notice in ways that made it invisible or inconsistent.

**The real lesson here isn't about AI being bad.** It's about the relationship between developer, IDE, and AI tools. Good design becomes extensive design. When I finally created a comprehensive reference system—a theme tab in the development area, consistent file structure, clear naming conventions—the AI tools (I now use Copilot, Gemini, and Amazon Q together) started respecting the guardrails.

But it took a month of chaos to get there. At one point, a Copilot update changed its behavior entirely. It lost the ability to reference my existing code and rules. The result? Duplicate code, wild file reorganizations, entire directories in the wrong place. I had to rebuild sections of the plugin from scratch.

That experience taught me something valuable: **until there's synergy between your IDE, your development practices, and your AI tools, mistakes will happen fast and compound quickly.** The solution wasn't to abandon AI—it was to master multiple tools and use them in concert.

Now I use three different AI assistants, each with different strengths. They catch each other's mistakes. They validate each other's suggestions. And most importantly, they respect the guardrails I've built into the codebase.

This is the future of development, I think. Not AI replacing developers, but developers learning to work *with* AI in a disciplined way.

---

## From Pain to Feature: The Trailing Stop Loss Story

Some of the best features come from personal loss. The Trailing Stop Loss alert system is one of them.

I've been caught out before. You identify a winning trade, the stock climbs, and you think "I'll check it later." Then you don't. The market shifts, and suddenly your profit evaporates. It happens to everyone, but it stings more when you know it was preventable.

Most trading platforms with API access have built-in stop loss functionality. But what about the platforms that don't? What about brokers that don't expose that capability? You're left manually monitoring your positions, which is impractical if you're not glued to your screen 24/7 (and let's be honest, only professionals do that).

So I built an alert system. When your portfolio reaches a certain profit level, TradePress alerts you. Then it suggests applying a "Trailing Stop Loss"—not an automated one (since the platform doesn't support it), but a manual one. You set the threshold, and TradePress watches it. If the price drops below that threshold, you get an alert. You're responsible for reacting, but at least you're not blindsided.

It's not perfect. It's not automated. But it's better than nothing, and it's saved me from losses multiple times already.

This feature exists because I felt the pain of not having it. And I suspect I'm not alone.

---

## What Success Actually Looks Like

Here's where I'm going to be radically honest about my ambitions.

Everyone talks about "10,000 users" or "unicorn status." Those aren't my goals. My real success metric is this: **5 users who are consistently profitable using TradePress and are willing to support me financially.**

That's it. Five users. Real profit. Real commitment.

Why? Because it proves the concept works. It proves that the scoring directives actually help people make better trading decisions. It proves that someone, somewhere, found enough value in what I built to pay for it.

From there, everything else becomes possible. A community marketplace for strategies. A training plugin. Automated trading features. But without those five users proving the core value, everything else is just speculation.

My 12-month goal is more modest: 50 regular visitors who either use the plugin or keep tabs on its progress. That's a foundation. That's validation that people care.

And here's the thing—I'm not hiding this metric. I'm publishing it. I'm being transparent about what success means to me. Because if I hit it, I want people to know. And if I don't, I want to understand why.

---

## The Scoring Algorithm: Aiming for 70%

The trading community has a benchmark: a strategy that wins 70% of the time is considered successful. Some strategies are profitable at 60%, but 70% is the target.

That's what I'm building toward. Every directive, every weighting, every feature in TradePress is designed to help you build strategies that hit that 70% threshold.

To validate this, I'm planning a paper trading system—a way to backtest strategies against historical data before you risk real money. This will be partly built into TradePress itself, and partly into a separate training plugin that I'll develop once I have those five profitable users.

The paper trading system will do something important: it will score submitted strategies against historical data, rating them based on performance. This creates a competitive environment where high-performing strategies rise to the top. It also gives me (and the community) real data about what works.

---

## Why Community Matters (More Than You Think)

I could have built TradePress as a closed-source product. I could have charged from day one. I could have kept all the insights to myself.

Instead, I open-sourced it on GitHub. And I'm building community infrastructure around it.

Why? Because the best trading insights come from shared experience. A developer who understands WordPress might have ideas I'd never think of. A trader with 20 years of experience might see patterns in the scoring algorithm that I missed. A beginner might ask questions that force me to simplify and clarify.

TradePress is meant to be a common cause—a place where traders and developers come together. Not because I was isolated in my journey (though I was), but because I see the opportunity to build something bigger than myself.

The community strategy marketplace I'm planning isn't just a feature. It's a philosophy. Users will share strategies, test them against historical data, and learn from each other. The best strategies will rise to the top. The community will validate what works.

This is how you build something that lasts. Not by hoarding ideas, but by creating a space where ideas can be tested, refined, and shared.

---

## The Bigger Picture: What's Coming

TradePress is still in its early stages. The core is solid—the scoring directives work, the API integrations are reliable, the strategy builder is functional. But there's so much more to come.

**Phase 2** includes automated trading execution, advanced analytics dashboards, and machine learning optimization of the scoring algorithm. I'm also planning to integrate AI validation—having the algorithm suggest its own strength and confidence levels.

**Phase 3** is where it gets ambitious: a community strategy marketplace, mobile app integration, advanced risk management tools, and predictive analytics.

But here's what I'm *not* building: options trading. I don't have enough experience there, and I'd rather do one thing well than many things poorly. I'm also deliberately not fully planning out the AI integration yet. That's a frontier I want to explore thoughtfully, not rush into.


---

## Why Now? Why WordPress? Why Me?

People ask why I chose WordPress and PHP for a trading platform. Wouldn't a modern JavaScript framework be better? Wouldn't a dedicated fintech stack make more sense?

Maybe. But WordPress has something those don't: accessibility. Millions of people already know WordPress. Millions of hosting providers support it. The barrier to entry is low. And the plugin ecosystem is mature enough to handle complex functionality.

Plus, I'm a WordPress developer. I know the platform inside and out. I can build faster, better, and more reliably in WordPress than I could in any other framework.

The real turning point wasn't a specific event. It was a gut feeling—the convergence of two passions. I've been building WordPress sites for years. I've been learning to trade for the past few years. And suddenly, I realized: these two worlds could collide in a meaningful way.

The trading community is always looking for an edge. They're always seeking better tools. And GitHub visibility means that if I build something good, people will find it.

---

## What I'm Asking For

I'm not asking for money (though GitHub Sponsors is open if you want to support development). I'm not asking for code contributions (though they're welcome). I'm asking for something simpler: **attention and feedback.**

Try TradePress. Break it. Tell me what doesn't work. Tell me what you wish it could do. Tell me if the scoring directives actually help you make better decisions.

And if you're one of those five users who becomes profitable using it, let me know. Because that's the story I want to tell next.

---

## The Journey Continues

Building TradePress has been the most challenging and rewarding project of my career. It's forced me to think deeply about trading, about software architecture, about the relationship between developers and AI tools, and about what it means to build something that matters.

It's also taught me humility. I don't have all the answers. The plugin will evolve. The community will shape it. The market will validate or reject it.

But I'm confident about one thing: there's a gap in the market for a tool like this. A tool that's adaptive, transparent, and built by someone who actually trades. A tool that respects the complexity of the market while making it accessible to beginners.

TradePress is that tool. And we're just getting started.

---

**Want to follow the journey?** Star the repository on GitHub. Join the discussions. Try the plugin. And if you become one of those five profitable users, reach out. I'd love to hear your story.

The best is yet to come.
