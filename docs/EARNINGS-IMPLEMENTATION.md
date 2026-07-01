# Earnings-Based Feature Implementation Guide

This document provides detailed specifications for implementing the high-priority earnings-based features in TradePress. These features leverage insights from successful trading platforms and are designed to enhance the scoring system with earnings-related metrics that are critical for effective trading decisions.

## Table of Contents
1. [Overview](#overview)
2. [Data Sources](#data-sources)
3. [Database Requirements](#database-requirements)
4. [Implementation Details](#implementation-details)
5. [UI Components](#ui-components)
6. [Integration with Existing Systems](#integration-with-existing-systems)
7. [Testing Strategy](#testing-strategy)
8. [Performance Considerations](#performance-considerations)

## Overview

The earnings-based features consist of four core components that work together to provide comprehensive earnings analysis:

1. **Earnings Event Proximity**: Adjusts stock scores based on nearness to earnings announcements
2. **Earnings Surprise Analysis**: Evaluates the difference between expected and actual earnings
3. **Pre/Post-Earnings Behavior Tracking**: Analyzes historical price patterns around earnings events
4. **Analyst Sentiment Integration**: Incorporates analyst expectations and revisions

These features will be implemented as Scoring Directives in the TradePress system, each contributing to the final score for a symbol according to the weighting specified in the active strategy.

## Data Sources

### Required External Data

| Data Type | Potential API Sources | Update Frequency | Notes |
|-----------|----------------------|------------------|-------|
| Earnings Calendar | Financial Modeling Prep, Alpha Vantage, Yahoo Finance | Daily | Contains upcoming earnings dates |
| Earnings History | Financial Modeling Prep, Alpha Vantage | Quarterly | Historical EPS data (actual vs estimate) |
| Analyst Ratings | Financial Modeling Prep, Finnhub | Weekly | Consensus ratings, price targets |
| Whisper Numbers | Earnings Whispers API (if available), Web Scraping | Weekly | Unofficial earnings expectations |
| Historical Price Data | Alpha Vantage, Polygon, Yahoo Finance | Daily | For pre/post earnings price analysis |

### Data Collection Strategy

1. **Primary/Secondary Sources**: Each data type should have a primary API source and at least one backup source
2. **Caching Policy**: 
   - Earnings calendar: 24-hour cache with forced refresh 7 days before expected earnings date
   - Earnings history: 7-day cache
   - Analyst ratings: 2-day cache
   - Historical data: 24-hour cache

3. **API Fallback Sequence**:
   ```
   try:
     primary_api_source()
   except RateLimitExceeded:
     secondary_api_source()
   except APIError:
     tertiary_api_source()
   except AllAPIsFailed:
     use_cached_data() or display_warning()
   ```

## Database Requirements

Create the following database tables to support earnings-based features:

### 1. Earnings Calendar Table

```sql
CREATE TABLE {$table_prefix}_earnings_calendar (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  symbol_id bigint(20) NOT NULL,
  earnings_date datetime NOT NULL,
  before_after_market enum('before', 'after', 'during', 'unknown') DEFAULT 'unknown',
  fiscal_quarter varchar(10) NOT NULL,
  fiscal_year int(4) NOT NULL,
  estimated_eps decimal(10,4) DEFAULT NULL,
  estimated_revenue decimal(20,2) DEFAULT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  data_source varchar(50) NOT NULL,
  PRIMARY KEY (id),
  KEY symbol_id (symbol_id),
  KEY earnings_date (earnings_date)
);
```

### 2. Earnings History Table

```sql
CREATE TABLE {$table_prefix}_earnings_history (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  symbol_id bigint(20) NOT NULL,
  earnings_date datetime NOT NULL,
  fiscal_quarter varchar(10) NOT NULL,
  fiscal_year int(4) NOT NULL,
  estimated_eps decimal(10,4) DEFAULT NULL,
  actual_eps decimal(10,4) DEFAULT NULL,
  eps_surprise decimal(10,4) DEFAULT NULL,
  eps_surprise_percent decimal(10,4) DEFAULT NULL,
  estimated_revenue decimal(20,2) DEFAULT NULL,
  actual_revenue decimal(20,2) DEFAULT NULL,
  revenue_surprise decimal(20,2) DEFAULT NULL,
  whisper_eps decimal(10,4) DEFAULT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  data_source varchar(50) NOT NULL,
  PRIMARY KEY (id),
  KEY symbol_id (symbol_id),
  KEY earnings_date (earnings_date)
);
```

### 3. Analyst Ratings Table

```sql
CREATE TABLE {$table_prefix}_analyst_ratings (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  symbol_id bigint(20) NOT NULL,
  rating_date datetime NOT NULL,
  analyst_firm varchar(100) DEFAULT NULL,
  rating enum('buy', 'outperform', 'hold', 'underperform', 'sell') DEFAULT NULL,
  previous_rating enum('buy', 'outperform', 'hold', 'underperform', 'sell') DEFAULT NULL,
  target_price decimal(10,2) DEFAULT NULL,
  previous_target_price decimal(10,2) DEFAULT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  data_source varchar(50) NOT NULL,
  PRIMARY KEY (id),
  KEY symbol_id (symbol_id),
  KEY rating_date (rating_date)
);
```

### 4. Earnings Behavior Profile Table

```sql
CREATE TABLE {$table_prefix}_earnings_behavior_profile (
  id bigint(20) NOT NULL AUTO_INCREMENT,
  symbol_id bigint(20) NOT NULL,
  avg_pre_earnings_move decimal(10,4) DEFAULT NULL,
  avg_post_earnings_move decimal(10,4) DEFAULT NULL,
  avg_pre_earnings_days int(3) DEFAULT NULL,
  avg_post_earnings_days int(3) DEFAULT NULL,
  pre_earnings_volatility decimal(10,4) DEFAULT NULL,
  post_earnings_volatility decimal(10,4) DEFAULT NULL,
  beat_reaction_avg decimal(10,4) DEFAULT NULL,
  miss_reaction_avg decimal(10,4) DEFAULT NULL,
  last_calculated datetime NOT NULL,
  sample_size int(3) NOT NULL,
  confidence_level decimal(5,4) DEFAULT NULL,
  created_at datetime NOT NULL,
  updated_at datetime NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY symbol_id (symbol_id)
);
```

## Implementation Details

### 1. Earnings Event Proximity Directive

**Class Name**: `TradePress_Scoring_Directive_Earnings_Proximity`

**Core Logic**:
```php
class TradePress_Scoring_Directive_Earnings_Proximity extends TradePress_Scoring_Directive_Base {
    
    // Configuration parameters with defaults
    protected $proximity_weight = 25; // Weight for proximity component (out of 100)
    protected $earnings_history_weight = 40; // Weight for historical earnings reaction
    protected $max_days_before = 30; // Maximum days before earnings to start scoring
    protected $max_days_after = 7; // Maximum days after earnings to continue scoring
    protected $pre_earnings_curve = 'exponential'; // linear, exponential, logarithmic
    protected $post_earnings_curve = 'linear'; // linear, exponential, logarithmic
    
    // Calculate proximity score
    public function calculate_score($symbol_id) {
        $earnings_date = $this->get_upcoming_earnings_date($symbol_id);
        if (!$earnings_date) {
            return 0; // No earnings date available
        }
        
        $days_to_earnings = $this->calculate_days_difference($earnings_date);
        
        if ($days_to_earnings > $this->max_days_before || $days_to_earnings < -$this->max_days_after) {
            return 0; // Outside scoring window
        }
        
        // Calculate proximity score based on days to earnings
        if ($days_to_earnings >= 0) {
            // Pre-earnings score
            $proximity_score = $this->calculate_pre_earnings_score($days_to_earnings);
        } else {
            // Post-earnings score
            $proximity_score = $this->calculate_post_earnings_score(abs($days_to_earnings));
        }
        
        // Factor in historical earnings behavior
        $behavior_score = $this->calculate_behavior_score($symbol_id, $days_to_earnings);
        
        // Combine scores with weighting
        $final_score = (($proximity_score * $this->proximity_weight) + 
                        ($behavior_score * $this->earnings_history_weight)) / 
                        ($this->proximity_weight + $this->earnings_history_weight);
        
        return $final_score;
    }
    
    // Helper methods would be implemented here...
}
```

**Scoring Curve Algorithm**:

For pre-earnings scoring with exponential curve:
```php
protected function calculate_pre_earnings_score($days_to_earnings) {
    if ($days_to_earnings == 0) {
        return 100; // Maximum score on earnings day
    }
    
    switch ($this->pre_earnings_curve) {
        case 'exponential':
            return 100 * exp(-0.07 * $days_to_earnings); // Exponential decay
        case 'logarithmic':
            return 100 - (25 * log10($days_to_earnings + 1));
        case 'linear':
        default:
            return 100 * (1 - ($days_to_earnings / $this->max_days_before));
    }
}
```

### 2. Earnings Surprise Analysis Directive

**Class Name**: `TradePress_Scoring_Directive_Earnings_Surprise`

**Core Logic**:

This directive evaluates earnings surprises (both historical patterns and most recent) to predict future price movements:

```php
class TradePress_Scoring_Directive_Earnings_Surprise extends TradePress_Scoring_Directive_Base {
    
    // Configuration parameters with defaults
    protected $recent_quarters_weight = 70; // Weight for recent quarterly results
    protected $historical_pattern_weight = 30; // Weight for historical pattern
    protected $quarters_to_analyze = 8; // Number of quarters to analyze patterns
    protected $whisper_weight = 40; // Weight for whisper vs official estimate
    protected $eps_weight = 60; // Weight for EPS surprise
    protected $revenue_weight = 40; // Weight for revenue surprise
    
    public function calculate_score($symbol_id) {
        // Get last earnings data
        $last_earnings = $this->get_last_earnings_data($symbol_id);
        
        if (!$last_earnings) {
            return 0; // No earnings data available
        }
        
        // Calculate recent quarters score
        $recent_score = $this->calculate_recent_surprise_score($last_earnings);
        
        // Calculate historical pattern score
        $historical_score = $this->calculate_historical_pattern_score($symbol_id);
        
        // Combine scores
        $final_score = (($recent_score * $this->recent_quarters_weight) + 
                        ($historical_score * $this->historical_pattern_weight)) / 
                        ($this->recent_quarters_weight + $this->historical_pattern_weight);
        
        return $final_score;
    }
    
    protected function calculate_recent_surprise_score($earnings_data) {
        // Calculate EPS surprise score
        $eps_surprise_pct = $earnings_data['eps_surprise_percent'];
        $eps_score = $this->normalize_surprise_score($eps_surprise_pct, 20);
        
        // Calculate revenue surprise score
        $revenue_surprise_pct = ($earnings_data['actual_revenue'] - $earnings_data['estimated_revenue']) / 
                              $earnings_data['estimated_revenue'] * 100;
        $revenue_score = $this->normalize_surprise_score($revenue_surprise_pct, 15);
        
        // Calculate whisper score if available
        $whisper_score = 50; // Neutral default
        if (!empty($earnings_data['whisper_eps'])) {
            $whisper_diff = $earnings_data['actual_eps'] - $earnings_data['whisper_eps'];
            $whisper_score = $this->calculate_whisper_score($whisper_diff, $earnings_data['whisper_eps']);
        }
        
        // Calculate combined recent score with whisper impact
        $combined_official_score = (($eps_score * $this->eps_weight) + 
                                   ($revenue_score * $this->revenue_weight)) / 
                                   ($this->eps_weight + $this->revenue_weight);
        
        return (($combined_official_score * (100 - $this->whisper_weight)) + 
                ($whisper_score * $this->whisper_weight)) / 100;
    }
    
    // Additional helper methods would be implemented here...
}
```

### 3. Pre/Post-Earnings Behavior Directive

**Class Name**: `TradePress_Scoring_Directive_Earnings_Behavior`

This directive analyzes historical price patterns around earnings dates to predict future behavior:

```php
class TradePress_Scoring_Directive_Earnings_Behavior extends TradePress_Scoring_Directive_Base {
    
    protected $pre_earnings_weight = 60; // Higher weight for pre-earnings
    protected $post_earnings_weight = 40; // Lower weight for post-earnings
    protected $min_histories_required = 4; // Minimum earnings histories required
    protected $days_pre_earnings = 15; // Days before earnings to analyze
    protected $days_post_earnings = 5; // Days after earnings to analyze
    
    public function calculate_score($symbol_id) {
        // Get earnings behavior profile data
        $behavior_profile = $this->get_earnings_behavior_profile($symbol_id);
        
        if (!$behavior_profile || $behavior_profile['sample_size'] < $this->min_histories_required) {
            // If behavior profile doesn't exist or sample size too small, calculate it
            $this->generate_earnings_behavior_profile($symbol_id);
            $behavior_profile = $this->get_earnings_behavior_profile($symbol_id);
            
            if (!$behavior_profile) {
                return 50; // Neutral score if unable to calculate
            }
        }
        
        // Get upcoming earnings date
        $earnings_date = $this->get_upcoming_earnings_date($symbol_id);
        if (!$earnings_date) {
            return 50; // Neutral score if no upcoming earnings
        }
        
        $days_to_earnings = $this->calculate_days_difference($earnings_date);
        
        // Calculate score based on pre or post earnings period
        if ($days_to_earnings >= 0) {
            // Pre-earnings period
            return $this->calculate_pre_earnings_behavior_score($behavior_profile, $days_to_earnings);
        } else {
            // Post-earnings period
            return $this->calculate_post_earnings_behavior_score($behavior_profile, abs($days_to_earnings));
        }
    }
    
    protected function calculate_pre_earnings_behavior_score($profile, $days_to_earnings) {
        // If outside the window we analyze, return neutral
        if ($days_to_earnings > $this->days_pre_earnings) {
            return 50;
        }
        
        // Calculate how far into the pre-earnings window we are (as percentage)
        $window_progress = 100 - (($days_to_earnings / $this->days_pre_earnings) * 100);
        
        // Calculate expected move based on historical average
        $expected_move_direction = $profile['avg_pre_earnings_move'] >= 0 ? 1 : -1;
        $expected_move_magnitude = abs($profile['avg_pre_earnings_move']);
        
        // Scale the expected move based on window progress
        $scaled_move = $expected_move_magnitude * ($window_progress / 100);
        
        // Calculate confidence factor (0.5 to 1.0)
        $confidence = 0.5 + min(0.5, ($profile['sample_size'] / 20));
        
        // Adjust for volatility
        $volatility_factor = 1 + ($profile['pre_earnings_volatility'] / 100);
        
        // Convert to a score (0-100)
        $base_score = 50 + ($expected_move_direction * $scaled_move * 5);
        $adjusted_score = 50 + (($base_score - 50) * $confidence * $volatility_factor);
        
        // Ensure within bounds
        return max(0, min(100, $adjusted_score));
    }
    
    // Additional helper methods would be implemented here...
}
```

### 4. Analyst Sentiment Directive

**Class Name**: `TradePress_Scoring_Directive_Analyst_Sentiment`

This directive evaluates analyst ratings, revisions, and consensus changes:

```php
class TradePress_Scoring_Directive_Analyst_Sentiment extends TradePress_Scoring_Directive_Base {
    
    protected $rating_weight = 30; // Weight for current ratings
    protected $target_price_weight = 30; // Weight for price targets
    protected $revisions_weight = 40; // Weight for recent revisions
    protected $max_days_for_recent = 30; // Definition of "recent" in days
    
    public function calculate_score($symbol_id) {
        // Get analyst ratings
        $ratings = $this->get_analyst_ratings($symbol_id);
        
        if (empty($ratings)) {
            return 50; // Neutral score if no ratings
        }
        
        // Calculate current ratings score
        $ratings_score = $this->calculate_ratings_score($ratings);
        
        // Calculate price target score
        $price_target_score = $this->calculate_price_target_score($ratings, $symbol_id);
        
        // Calculate revisions score
        $revisions_score = $this->calculate_revisions_score($ratings);
        
        // Combine scores
        $final_score = (($ratings_score * $this->rating_weight) + 
                        ($price_target_score * $this->target_price_weight) + 
                        ($revisions_score * $this->revisions_weight)) / 
                        ($this->rating_weight + $this->target_price_weight + $this->revisions_weight);
        
        return $final_score;
    }
    
    protected function calculate_ratings_score($ratings) {
        // Count ratings by category
        $counts = [
            'buy' => 0,
            'outperform' => 0,
            'hold' => 0,
            'underperform' => 0,
            'sell' => 0
        ];
        
        foreach ($ratings as $rating) {
            if (isset($counts[$rating['rating']])) {
                $counts[$rating['rating']]++;
            }
        }
        
        // Calculate weighted score
        $total_ratings = array_sum($counts);
        $score = (($counts['buy'] * 100) + 
                  ($counts['outperform'] * 75) + 
                  ($counts['hold'] * 50) + 
                  ($counts['underperform'] * 25) + 
                  ($counts['sell'] * 0)) / $total_ratings;
        
        return $score;
    }
    
    // Additional helper methods would be implemented here...
}
```

## UI Components

### 1. Symbol View Earnings Tab

Create a dedicated "Earnings" tab in the Symbol post detail view with the following sections:

- **Earnings Calendar**: Display upcoming and past earnings dates
- **Earnings History**: Table of historical earnings with EPS and revenue surprises
- **Analyst Ratings**: Display consensus ratings and price targets
- **Earnings Behavior Profile**: Visualize pre/post earnings price patterns
- **Whisper Numbers**: Show official estimates vs. whisper numbers

### UI Implementation Example:

```php
function tradepress_render_earnings_tab($symbol_id) {
    ?>
    <div class="tradepress-earnings-tab">
        <div class="tradepress-tab-section">
            <h3>Earnings Calendar</h3>
            <?php tradepress_render_earnings_calendar($symbol_id); ?>
        </div>
        
        <div class="tradepress-tab-section">
            <h3>Earnings History</h3>
            <?php tradepress_render_earnings_history($symbol_id); ?>
        </div>
        
        <div class="tradepress-tab-section">
            <h3>Analyst Ratings</h3>
            <?php tradepress_render_analyst_ratings($symbol_id); ?>
        </div>
        
        <div class="tradepress-tab-section">
            <h3>Earnings Behavior Profile</h3>
            <?php tradepress_render_earnings_behavior_chart($symbol_id); ?>
        </div>
    </div>
    <?php
}
```

### 2. Earnings Calendar View

Create a global earnings calendar view showing:

1. Upcoming earnings for all tracked symbols
2. Filtering by date range, market cap, sector, etc.
3. Sorting by earnings date, symbol, expected move, etc.
4. Highlighting high-priority earnings events based on strategy settings

### 3. Scoring Directive Configuration UI

Implement configuration UI for each earnings directive with settings such as:

- Weights for different components
- Date ranges for analysis
- Threshold values for scoring
- Toggle for including/excluding from strategies

## Integration with Existing Systems

### 1. Integration with Scoring Algorithm

The earnings directives should be integrated into the scoring algorithm as follows:

```php
// Add earnings directives to the available directives
add_filter('tradepress_scoring_directives', 'tradepress_add_earnings_directives');
function tradepress_add_earnings_directives($directives) {
    $directives['earnings_proximity'] = [
        'name' => 'Earnings Event Proximity',
        'class' => 'TradePress_Scoring_Directive_Earnings_Proximity',
        'description' => 'Adjusts scores based on proximity to earnings announcements',
        'category' => 'earnings',
        'default_weight' => 15,
    ];
    
    $directives['earnings_surprise'] = [
        'name' => 'Earnings Surprise Analysis',
        'class' => 'TradePress_Scoring_Directive_Earnings_Surprise',
        'description' => 'Evaluates historical earnings surprises and their impact',
        'category' => 'earnings',
        'default_weight' => 20,
    ];
    
    $directives['earnings_behavior'] = [
        'name' => 'Pre/Post-Earnings Behavior',
        'class' => 'TradePress_Scoring_Directive_Earnings_Behavior',
        'description' => 'Analyzes price patterns around earnings dates',
        'category' => 'earnings',
        'default_weight' => 15,
    ];
    
    $directives['analyst_sentiment'] = [
        'name' => 'Analyst Sentiment',
        'class' => 'TradePress_Scoring_Directive_Analyst_Sentiment',
        'description' => 'Tracks analyst ratings and revisions',
        'category' => 'earnings',
        'default_weight' => 10,
    ];
    
    return $directives;
}
```

### 2. Integration with Data Collection System

Implement custom data fetchers for earnings data:

```php
// Register data fetchers for earnings data
add_filter('tradepress_data_fetchers', 'tradepress_register_earnings_data_fetchers');
function tradepress_register_earnings_data_fetchers($fetchers) {
    $fetchers['earnings_calendar'] = [
        'name' => 'Earnings Calendar',
        'class' => 'TradePress_Data_Fetcher_Earnings_Calendar',
        'api_endpoints' => ['fmp/calendar', 'alphavantage/earnings', 'yahoofinance/calendar'],
        'update_frequency' => 'daily',
        'cache_duration' => 86400, // 24 hours
    ];
    
    $fetchers['earnings_history'] = [
        'name' => 'Earnings History',
        'class' => 'TradePress_Data_Fetcher_Earnings_History',
        'api_endpoints' => ['fmp/earnings', 'alphavantage/earnings'],
        'update_frequency' => 'weekly',
        'cache_duration' => 604800, // 7 days
    ];
    
    $fetchers['analyst_ratings'] = [
        'name' => 'Analyst Ratings',
        'class' => 'TradePress_Data_Fetcher_Analyst_Ratings',
        'api_endpoints' => ['fmp/analyst', 'finnhub/recommendation'],
        'update_frequency' => 'daily',
        'cache_duration' => 172800, // 2 days
    ];
    
    return $fetchers;
}
```

### 3. Integration with API System

Example API class implementation for Financial Modeling Prep earnings data:

```php
class TradePress_FMP_Earnings_API extends TradePress_API_Base {
    
    public function get_earnings_calendar($symbol = '', $from = '', $to = '') {
        $endpoint = 'earnings-calendar';
        
        $params = [];
        if (!empty($symbol)) {
            $params['symbol'] = $symbol;
        }
        if (!empty($from)) {
            $params['from'] = date('Y-m-d', strtotime($from));
        }
        if (!empty($to)) {
            $params['to'] = date('Y-m-d', strtotime($to));
        }
        
        return $this->make_request($endpoint, $params);
    }
    
    public function get_earnings_history($symbol, $limit = 10) {
        $endpoint = 'historical-earning';
        
        $params = [
            'symbol' => $symbol,
            'limit' => $limit
        ];
        
        return $this->make_request($endpoint, $params);
    }
    
    public function get_analyst_ratings($symbol) {
        $endpoint = 'analyst-estimates';
        
        $params = [
            'symbol' => $symbol
        ];
        
        return $this->make_request($endpoint, $params);
    }
    
    // Additional API methods...
}
```

## Testing Strategy

### Unit Tests

Create unit tests for each directive with test cases covering:

1. Various earnings date proximities
2. Different earnings surprise scenarios
3. Various analyst rating distributions
4. Edge cases (no earnings data, extreme surprises, etc.)

Example test case for Earnings Proximity:

```php
function test_earnings_proximity_directive() {
    // Arrange
    $directive = new TradePress_Scoring_Directive_Earnings_Proximity();
    $symbol_id = 123; // Test symbol
    
    // Mock upcoming earnings date (5 days away)
    $mock_data = [
        'earnings_date' => date('Y-m-d', strtotime('+5 days')),
        'time' => 'after'
    ];
    
    // Act
    $score = $directive->calculate_score($symbol_id);
    
    // Assert
    $this->assertGreaterThan(50, $score); // Score should be above neutral for upcoming earnings
    $this->assertLessThan(90, $score); // But not at maximum since it's not immediate
}
```

### Integration Tests

Test the directives working together with other components:

1. Data fetching → processing → directive calculation
2. Strategy combination with other technical directives
3. UI rendering with various data scenarios
4. Database performance with large datasets

### Performance Tests

1. Benchmark directive calculation times with various dataset sizes
2. Analyze database query performance
3. Test caching effectiveness
4. Evaluate memory usage during bulk operations

## Performance Considerations

### Database Optimization

1. **Indexing Strategy**: Ensure all tables have proper indexes on lookup fields
2. **Query Optimization**: Use efficient queries, especially for historical data
3. **Partitioning**: Consider partitioning earnings history by year for large datasets
4. **Data Pruning**: Implement automated cleanup of outdated data

### Caching Approach

1. **Tiered Caching**:
   - L1: Object cache for frequently accessed data
   - L2: Transients for preprocessed directive results
   - L3: Database cache for raw API data

2. **Cache Invalidation Strategy**:
   - Time-based: Standard expiration for regular data
   - Event-based: Immediate invalidation for earnings announcements
   - Smart refresh: Background updates before cache expiration

### Asynchronous Processing

1. **Background Processing**:
   - Use WordPress cron for routine data updates
   - Process historical analysis during off-peak hours
   - Generate and cache earnings behavior profiles nightly

2. **Batch Processing**:
   - Process symbols in batches of 25-50
   - Prioritize symbols with upcoming earnings
   - Use progressive enhancement for UI (show available data while loading the rest)

## Conclusion

The earnings-based features represent a significant enhancement to the TradePress scoring system. By properly implementing these directives, the system will be able to capture important signals around earnings events that are often associated with significant price movements.

This implementation guide provides a framework for integrating these features while maintaining performance, scalability, and compatibility with the existing TradePress architecture.