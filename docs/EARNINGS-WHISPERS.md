# Tool Name: Earnings Whisper Opportunity Scorer
Status: Not Started
Percentage Complete: 0% 
Next Task: Improve this documentation, add clear steps

This involves two main parts:

Parsing: Extracting structured data from the unstructured text.
Scoring: Applying rules (directives) to the extracted data to generate an opportunity score.

Objective: To parse pasted text from Earnings Whisper reports, extract key financial and sentiment metrics, and apply a configurable scoring system to quantify the potential trading opportunity (primarily bullish bias, as per the typical "beat" focus).

Core Components:

Input Interface: A simple textarea where the user can paste the raw text report(s).
Parser Engine: PHP code responsible for analyzing the text and extracting data points for each stock mentioned.
Scoring Engine: Applies a set of defined "Scoring Directives" to the parsed data.
Strategy Manager: Defines which directives are active and potentially their weights.
Output Display: Shows the parsed data and the calculated scores for each stock found in the input text.
1. Data Extraction (Parsing Engine)

Challenge: This is the most complex and potentially fragile part, as it relies on the consistency of the Earnings Whisper text format. Regular expressions (regex) are the primary tool here.

Approach:

Report Splitting: First, split the pasted text into individual stock reports. This could be done by splitting the text based on lines matching the pattern ^[A-Za-z.\s]+ is Expected to (Beat|Miss) Estimates$.
Data Point Extraction (per report): For each individual report block, apply specific regex patterns to extract the following data points. Store these in an associative array keyed by the stock symbol.
Regex Examples (Conceptual - need refinement and testing):

Symbol & Company Name: ^Logo for (.*?)(?:, Inc\.)?(.*?)\s+\((.*?)\) is confirmed (Capture group 1/2 for name, 3 for symbol)
Report Date/Time: report earnings on (.*? \d{1,2}, \d{4}) at approximately (.*? ET)\. (Capture group 1 for date, 2 for time) or handle BMO/AMC variations.
Consensus EPS: consensus earnings estimate is \$(.*?)\s+per share
Consensus Revenue: on revenue of \$(.*?) (billion|million) (Need to handle billion/million conversion)
YoY Revenue Growth: representing (.*?)% year-over-year revenue growth
Whisper EPS: Earnings Whisper ® number is \$(.*?) per share
Guidance (Revenue): guidance was for revenue of \$(.*?) (billion|million) to \$(.*?) (billion|million)
Guidance (EPS): guidance was for earnings of \$(.*?) to \$(.*?) per share (Handle variations like "approximately")
Investor Sentiment: Investors are (bullish|bearish) going into
% Expecting Beat: with (.*?)% expecting a beat
Short Interest Change: Short interest has (increased|decreased) by (.*?)%
Stock Price Drift: stock has drifted (lower|higher) by (.*?)%
vs. 200d MA: to be (.*?)% (above|below) its 200 day moving average of \$(.*?)
Estimate Revision Trend: Overall earnings estimates have been revised (lower|higher)
Options Activity: notable buying of ([\d,]+) contracts of the \$(.*?) (call|put) expiring on (.*? \d{1,2}, \d{4}) (Extract date separately if needed)
Overall Expectation: Extract from the initial report split pattern ("Beat" or "Miss").
Data Structure (Output of Parser):

php
$parsed_data = [
    'META' => [
        'company_name' => 'Meta Platforms',
        'report_date' => '2025-04-30',
        'report_time' => '4:40 PM ET', // Normalize BMO/AMC if possible
        'consensus_eps' => 5.21,
        'consensus_revenue_b' => 41.27, // Store in billions/millions consistently
        'revenue_growth_yoy' => 13.2,
        'whisper_eps' => 5.40,
        'guidance_revenue_low_b' => 39.50,
        'guidance_revenue_high_b' => 41.80,
        'guidance_eps_low' => null, // Example if not present
        'guidance_eps_high' => null,
        'investor_sentiment' => 'bullish',
        'percent_expecting_beat' => 84.7,
        'short_interest_change' => 5.6, // Positive for increase, negative for decrease
        'price_drift_since_earnings' => -21.5, // Negative for lower, positive for higher
        'vs_200d_ma_percent' => -4.9, // Negative for below, positive for above
        'ma_200_value' => 575.70,
        'estimate_revision_trend' => 'lower',
        'options_activity_contracts' => 9424,
        'options_activity_strike' => 550.00,
        'options_activity_type' => 'call',
        'options_activity_expiry' => '2025-05-02',
        'options_activity_date' => '2025-04-25',
        'overall_expectation' => 'beat', // 'beat' or 'miss'
    ],
    'AMZN' => [ /* ... similar data ... */ ],
    // ... other stocks
];
2. Scoring Directives (Individual Rules)

These directives take the parsed data for a single stock and return a score (positive for bullish, negative for bearish).

Directive: WhisperVsConsensusEPS

Input: whisper_eps, consensus_eps
Logic: Calculate the percentage difference: ((whisper - consensus) / abs(consensus)) * 100.
Scoring:
> 3%: +15 points
1% to 3%: +10 points
0% to 1%: +5 points
-1% to 0%: -5 points
< -1%: -10 points
Consensus <= 0: 0 points (or handle differently if whisper is positive)
Rationale: Whisper beating consensus is a strong bullish indicator.
Directive: RevenueGrowthYoY

Input: revenue_growth_yoy
Logic: Check the growth rate.
Scoring:
> 15%: +10 points
5% to 15%: +5 points
0% to 5%: +2 points
< 0%: -5 points
Rationale: Strong revenue growth is bullish.
Directive: InvestorSentiment

Input: investor_sentiment, percent_expecting_beat
Logic: Check sentiment and conviction level.
Scoring:
Sentiment = bullish AND % Beat > 75%: +10 points
Sentiment = bullish AND % Beat <= 75%: +5 points
Sentiment = bearish AND % Beat > 65%: +2 points (Contrarian bullish signal?)
Sentiment = bearish AND % Beat <= 65%: -5 points
Rationale: High bullish conviction is positive. High % expecting beat even with bearish sentiment might indicate underlying strength or a potential squeeze.
Directive: ShortInterestChange

Input: short_interest_change (positive for increase, negative for decrease)
Logic: Check the direction and magnitude of change.
Scoring:
Change < -10%: +10 points (Significant short covering)
Change -10% to 0%: +5 points (Short covering)
Change 0% to 10%: -2 points (Slight increase)
Change 10% to 50%: -5 points (Notable increase)
Change > 50%: -10 points (Very high increase, potentially bearish or squeeze setup)
Rationale: Decreasing short interest is bullish. High increases could be bearish or set up a short squeeze.
Directive: PriceVs200MA

Input: vs_200d_ma_percent (positive for above, negative for below)
Logic: Check position relative to the long-term moving average.
Scoring:
> 5%: +8 points
0% to 5%: +4 points
-5% to 0%: -4 points
< -5%: -8 points
Rationale: Price above the 200d MA is a bullish technical signal.
Directive: EstimateRevisionTrend

Input: estimate_revision_trend
Logic: Check if estimates have been revised higher or lower.
Scoring:
Trend = higher: +7 points
Trend = lower: -7 points
Rationale: Analysts revising estimates higher is bullish.
Directive: NotableOptionsActivity

Input: options_activity_type, options_activity_contracts (Potentially date/expiry for weighting)
Logic: Check if the notable activity is calls (bullish) or puts (bearish).
Scoring:
Type = call: +5 points (+ bonus for high volume/recent activity, e.g., +2 if > 10k contracts)
Type = put: -5 points
Rationale: Significant call buying suggests bullish speculation, puts suggest bearishness.
Directive: GuidanceVsConsensus

Input: guidance_revenue_low_b, guidance_revenue_high_b, consensus_revenue_b, guidance_eps_low, guidance_eps_high, consensus_eps
Logic: Compare the midpoint or range of guidance to the consensus. Check both Revenue and EPS if available.
Scoring (Combine Revenue & EPS checks):
Guidance Midpoint > Consensus (Rev OR EPS): +5 points
Guidance Midpoint > Consensus (Rev AND EPS): +10 points
Guidance Range fully above Consensus (Rev OR EPS): +8 points
Guidance Range fully above Consensus (Rev AND EPS): +15 points
Guidance Midpoint < Consensus (Rev OR EPS): -5 points
Guidance Range fully below Consensus (Rev OR EPS): -10 points
(Add variations if only one type of guidance is given)
Rationale: Company guiding higher than expectations is strongly bullish.
Directive: OverallExpectationTitle

Input: overall_expectation ('beat' or 'miss')
Logic: Check the title expectation.
Scoring:
Expectation = beat: +5 points (Baseline positive expectation)
Expectation = miss: -10 points (Baseline negative expectation)
Rationale: Reflects the headline sentiment from Earnings Whisper.
Directive: PriceDriftSinceEarnings

Input: price_drift_since_earnings
Logic: Check if the stock drifted higher or lower.
Scoring:
Drift > 0%: +3 points
Drift < 0%: -3 points
Rationale: Less critical than other factors, but positive drift shows some resilience/momentum.
3. Overall Score Calculation & Strategy

Strategy Definition:
Create a concept of a "Strategy". A strategy defines which directives are active and, optionally, assigns a weight to each active directive.
Example Strategy "Standard Bullish": Activate all directives above with a weight of 1.0 each.
Example Strategy "Technically Focused": Activate PriceVs200MA, PriceDriftSinceEarnings, ShortInterestChange with weight 1.5, others with weight 0.5 or inactive.
Scoring Engine Logic:
Takes the parsed_data for one stock.
Takes the active Strategy.
Iterates through the active directives defined in the Strategy.
For each active directive:
Calls the directive's scoring function with the relevant parsed_data.
Multiplies the returned score by the directive's weight from the Strategy.
Sums the weighted scores from all active directives to get the Total Opportunity Score.
Score Interpretation: Define thresholds for the Total Opportunity Score:
> 60: High Bullish Opportunity
40 to 60: Medium Bullish Opportunity
20 to 40: Low Bullish Opportunity
-20 to 20: Neutral / Unclear
< -20: Potential Bearish Opportunity (or Avoid)
4. User Interface (UI)

Input: A large <textarea> element.
Controls:
A "Parse & Score" <button>.
(Optional) A <select> dropdown to choose the scoring Strategy.
Output:
A table displaying the results for each stock found.
Columns: Symbol, Company Name, Report Date/Time, Whisper vs Consensus (%), Sentiment, Short Interest (%), vs 200d MA (%), Est Trend, Options, Total Score, Opportunity Level (High/Medium/Low).
Make the "Total Score" column visually distinct (e.g., background color based on score).
5. Implementation Details

Language: PHP (within your WordPress plugin structure).
Parsing: Use preg_match_all extensively. Create helper functions for converting numbers (e.g., "$1.2B" to 1.2), normalizing dates/times. Consider a dedicated EarningsWhisperParser class.
Scoring:
Create an interface or abstract class ScoringDirective.
Implement each directive as a separate class implementing this interface (e.g., class WhisperVsConsensusEPS_Directive implements ScoringDirective). Each class would have a calculate_score(array $parsed_data) method.
Create a Strategy class to hold directive configurations (active status, weights).
Create a ScoringEngine class that takes parsed_data and a Strategy object to calculate the total score.
Location: This could be a new "QuickTool" within TradePress_Admin_QuickTools or a dedicated sub-tab under the "Research" -> "Earnings" tab (earnings-tab.php). Given the complexity, a dedicated sub-tab might be better.
6. Limitations & Considerations

Parser Fragility: The parser heavily depends on the exact text format of Earnings Whisper. Any changes to their website output will break the parser and require updating the regex patterns. This is the biggest maintenance challenge.
Data Ambiguity: Some phrases might be ambiguous or formatted unexpectedly. Error handling during parsing is crucial.
Missing Data: Reports might not always contain all data points. Directives need to handle missing input gracefully (e.g., return 0 score).
Subjectivity: The point values and weights assigned in the directives and strategies are subjective and should be configurable or at least easily adjustable based on backtesting or user preference.
BMO/AMC Timing: Normalizing "Before Market Open" / "After Market Close" to specific comparable times might be needed for some analyses but isn't strictly required for this scoring model.
Guidance Complexity: Parsing guidance can be tricky due to variations ("approximately", ranges, only EPS or only Revenue).