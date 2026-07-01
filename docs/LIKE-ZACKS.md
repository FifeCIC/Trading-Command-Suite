Tool Name: "Earnings Momentum Screener" or "Analyst Revision Surprise Finder"

Objective: Identify stocks reporting earnings soon that exhibit positive analyst estimate momentum and have a favorable consensus analyst rating, suggesting a higher likelihood of beating the current consensus estimate.

1. Core Concept & Logic (The "Non-Zacks ESP"):

Instead of Zacks Most Accurate Estimate: We'll use the trend of the Consensus EPS Estimate itself. We need to compare the current consensus estimate to the consensus estimate from a recent point in the past (e.g., 7, 14, or 30 days ago). A positive change indicates upward momentum.
Alternative (if historical consensus is unavailable): Count the number of upward vs. downward analyst EPS estimate revisions within the last X days. More upward revisions suggest positive momentum.
Instead of Zacks Consensus Estimate: We use the standard, Current Consensus EPS Estimate available from many financial data providers.
Instead of Zacks Rank (#1, #2, #3): We'll use the Consensus Analyst Rating (e.g., Strong Buy, Buy, Hold). This is a commonly available metric that reflects overall analyst sentiment.
Calculation ("Surprise Momentum Percent" - SMP):
SMP = ((Current Consensus EPS - Consensus EPS [X days ago]) / abs(Consensus EPS [X days ago])) * 100
Handle cases where the past consensus was zero or negative appropriately (e.g., return 0, null, or use a different logic like simple difference if the denominator is problematic).
Filtering Rule: Stocks with SMP > 0 (or a user-defined threshold) AND a Consensus Analyst Rating of 'Strong Buy', 'Buy', or 'Hold', reporting earnings within a specified future timeframe.
2. Data Source Requirements:

Critical: You need a financial data API provider that supplies the following data points per stock symbol:
Upcoming Earnings Date: The expected date of the next earnings report.
Current Consensus EPS Estimate: The average EPS estimate from analysts covering the stock right now.
Historical Consensus EPS Estimate: The consensus EPS estimate as it stood X days ago (e.g., 7, 14, 30 days ago). This is the most crucial and potentially hardest data point to find reliably via API. Verify your chosen provider offers this.
Alternative Data (if historical consensus unavailable): Detailed Analyst Estimate Revisions data (Number of upward revisions, number of downward revisions within the last X days).
Consensus Analyst Rating/Recommendation: The overall rating (e.g., scale of 1-5, or terms like Strong Buy, Buy, Hold, Sell, Strong Sell).
API Provider Examples: Investigate providers like Financial Modeling Prep (FMP), EOD Historical Data (EODHD), Finnhub, Polygon.io, Alpha Vantage (check their specific endpoints and data availability carefully, especially for historical consensus or revision details).
API Service Integration (class.tradepress-financial-api-service.php):
A new method will be needed, e.g., get_earnings_momentum_data(array $symbols, int $lookback_days).
This method must query the chosen API for the required data points for the given symbols.
It should normalize the output, especially the Analyst Rating, into a consistent format (e.g., 'Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell').
Expected Data Structure (Ideal):
json
{
  "symbol": "AAPL",
  "earnings_date": "YYYY-MM-DD",
  "current_consensus_eps": 1.50,
  "past_consensus_eps": 1.45, // Based on lookback_days
  "analyst_rating": "Buy"
}
(Or include revision counts if using the alternative method)
3. Tool Implementation (QuickTool):

Location: TradePress_Admin_QuickTools class.
Method Name: tool_earnings_momentum_screener.
Tool Info Array ($tool_info):
title: "Earnings Momentum Screener"
description: "Finds stocks with positive earnings estimate momentum and favorable analyst ratings ahead of their earnings report."
category: "Screening" or "Analysis"
capability: manage_options
User Interface (Settings Form):
Nonce field: wp_nonce_field('tradepress_earnings_momentum_action', 'tradepress_earnings_momentum_nonce');
Input (Number): "Earnings within next X days:" (Default: 14) - name="earnings_days_ahead"
Input (Number): "Momentum Lookback Period (days):" (Default: 30) - name="momentum_lookback_days" (Crucial for historical data fetch).
Input (Number): "Minimum Surprise Momentum % (SMP):" (Default: 0, allow decimals) - name="min_smp_percent"
Input (Checkbox Group/Multiselect): "Include Analyst Ratings:" (Defaults: Strong Buy, Buy, Hold checked) - name="include_ratings[]"
Submit Button: "Run Screener"
Processing Logic (within the tool method, after form submission):
Verify nonce.
Sanitize user inputs (earnings_days_ahead, momentum_lookback_days, min_smp_percent, include_ratings).
Get the list of relevant symbols (e.g., from 'Symbols' CPT or a predefined list).
Call the API service: $data = $api_service->get_earnings_momentum_data($symbols, $momentum_lookback_days); (Implement caching here).
Iterate through the returned $data for each symbol.
Filter by Earnings Date: Check if earnings_date is within the next earnings_days_ahead.
Filter by Analyst Rating: Check if analyst_rating is in the user-selected include_ratings.
Calculate SMP:
Check if current_consensus_eps and past_consensus_eps are valid numbers.
Handle division by zero/invalid past data.
$smp = calculate_smp($current_consensus_eps, $past_consensus_eps);
Filter by SMP: Check if $smp >= $min_smp_percent.
Store matching symbols and their data in an array for display.
Results Display:
HTML table showing the filtered stocks.
Columns: Symbol, Company Name (if available), Earnings Date, Analyst Rating, Current Consensus EPS, Past Consensus EPS (or Revision Info), Calculated SMP (%).
Format SMP as a percentage.
Include sorting options (JS or server-side).
Display "No results found" or API error messages clearly.
Show "Last updated" timestamp based on data fetch/cache time.
4. Helper Functions:

calculate_smp($current, $past): Encapsulates the SMP calculation logic, including error/edge case handling. Resides within the QuickTool class or a helper class.
5. Data Caching:

Use WordPress Transients API to cache the results from get_earnings_momentum_data.
Transient Key: Include symbol and lookback period, e.g., tradepress_earn_mom_{symbol}_{lookback_days}.
Expiration: 6-12 hours (6 * HOUR_IN_SECONDS). Check transient before making an API call.
6. Error Handling:

Handle API connection errors, invalid keys, rate limits.
Gracefully handle symbols where the API doesn't return all required data (especially historical consensus or ratings) - skip the symbol and potentially log the issue.
Handle calculation errors (division by zero in SMP).
7. Key Considerations & Differences from Zacks:

Data Availability: The success hinges entirely on finding an API provider that reliably offers historical consensus EPS data or detailed revision counts. This is the biggest risk and needs verification first.
No "Secret Sauce": This method relies on publicly observable data trends (consensus changes, ratings) rather than a proprietary "Most Accurate Estimate" or complex "Rank". Its predictive power may differ significantly from the claimed 70% of Zacks ESP.
Transparency: This method is transparent. You know exactly how the "SMP" is calculated and which ratings are included.
Customization: You can adjust the lookback period and minimum SMP threshold.