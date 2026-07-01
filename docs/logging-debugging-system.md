
# Create Additional Log 
Create an additional .log file and system for background activity and user actions. 
Begin by creating a plan. 

- Review the current approach to logging and debugging: WP_Error, debug.log, my custom "BugNet" system (is there any innovation in BugNet?)
- Does BugNet have a strong enough approach to warrant keeping it or should we start over? 
- Begin plans for a system that will help to investigate faults, with diagnostic features, using all available data
- Consider which database tables planned for TradePress or already installed, will offer data that can be used to create detailed and interactive logs
- Once that plan is written, factor in two new .log files to reduce what I believe is an over-use of "debug.log" 
- I want the new .log files to log unseen activity (asynchronus, CRON), maybe call "automation.log" and user actions "user.log" 
- Examine the plugin for logging that fits that criteria and begun logging it
- This will require a settings area starting with a list of checkboxes to include/exclude specific actions, types of activities, 

## TradePress Enhanced Logging System Plan

### Current Logging Analysis

#### Existing Systems Review:
1. **WordPress debug.log** - Standard WordPress error logging (overused)
2. **TradePress_API_Logging Class** - Comprehensive API call logging to database tables:
   - `tradepress_calls` - API call records
   - `tradepress_endpoints` - Endpoint usage tracking
   - `tradepress_errors` - Error details
   - `tradepress_meta` - Additional metadata
3. **BugNet System** - Custom debugging framework with:
   - Events service
   - Logging service  
   - Tracing service
   - Multiple handlers (email, files, REST API, database)
   - Level-based filtering (emergency, alert, critical, error, warning, notice)
   - Report generation

#### BugNet Assessment:
**Strengths:**
- Comprehensive level-based logging system
- Multiple output handlers
- Configurable switches for granular control
- Database integration
- Report generation capabilities

**Weaknesses:**
- Complex installation process
- Requires separate activation
- Not currently integrated with core TradePress functionality
- May be over-engineered for current needs

**Recommendation:** Keep BugNet as advanced debugging tool, but create simpler logging system for daily operations.

### New Logging System Architecture

#### Core Components:
1. **TradePress_Logger Class** - Central logging coordinator
2. **automation.log** - Background/CRON activity logging
3. **user.log** - User action logging
4. **Enhanced diagnostic system** - Interactive log analysis
5. **Settings interface** - Granular logging controls

#### Database Integration:
Leverage existing tables plus new logging tables:
- `tradepress_logs` - Centralized log entries
- `tradepress_log_meta` - Log metadata and context
- `tradepress_user_actions` - User activity tracking
- `tradepress_automation_events` - Background process logging

### Implementation Plan

#### Phase 1: Core Logger Class
```php
class TradePress_Logger {
    const AUTOMATION = 'automation';
    const USER = 'user';
    const API = 'api';
    const ERROR = 'error';
    const DEBUG = 'debug';
    
    public static function log($message, $type, $context = array())
    public static function automation($message, $context = array())
    public static function user_action($action, $context = array())
    public static function error($message, $context = array())
}
```

#### Phase 2: Log File Management
- **automation.log** - CRON jobs, background processes, API calls, data imports
- **user.log** - Form submissions, tab switches, settings changes, manual actions
- **error.log** - PHP errors, exceptions, critical failures
- **debug.log** - Development debugging (when enabled)

#### Phase 3: Settings Interface
Add to Settings > BugNet tab:
```
☐ Enable Automation Logging
☐ Enable User Action Logging
☐ Enable API Call Logging
☐ Enable Error Logging
☐ Enable Debug Logging

Automation Log Settings:
☐ CRON Job Execution
☐ Background Data Processing
☐ API Rate Limiting Events
☐ Database Maintenance
☐ Cache Operations

User Action Settings:
☐ Page Navigation
☐ Form Submissions
☐ Settings Changes
☐ Manual API Tests
☐ File Uploads
☐ Search Operations
```

#### Phase 4: Enhanced Diagnostics
Create diagnostic dashboard showing:
- Real-time log streaming
- Log filtering and search
- Performance metrics
- Error pattern analysis
- User activity heatmaps
- Automation health monitoring

### Logging Categories & Implementation

#### Automation Logging (automation.log):
```php
// CRON Jobs
TradePress_Logger::automation('Earnings calendar CRON started', ['cron' => 'earnings_calendar']);
TradePress_Logger::automation('Processed 150 symbols', ['processed' => 150, 'duration' => '45s']);

// Background Processing
TradePress_Logger::automation('Algorithm scoring initiated', ['strategy' => 'momentum', 'symbols' => 50]);
TradePress_Logger::automation('Data import completed', ['source' => 'alphavantage', 'records' => 1200]);

// API Rate Limiting
TradePress_Logger::automation('API rate limit reached', ['service' => 'alpaca', 'reset_time' => '2024-01-15 14:30:00']);
```

#### User Action Logging (user.log):
```php
// Navigation
TradePress_Logger::user_action('page_view', ['page' => 'research', 'tab' => 'earnings']);

// Form Submissions
TradePress_Logger::user_action('form_submit', ['form' => 'api_settings', 'service' => 'alpaca']);

// Manual Operations
TradePress_Logger::user_action('manual_api_test', ['service' => 'alphavantage', 'endpoint' => 'quote']);
TradePress_Logger::user_action('symbol_search', ['query' => 'AAPL', 'results' => 1]);
```

### Database Schema Extensions

#### tradepress_logs table:
```sql
CREATE TABLE tradepress_logs (
    id bigint(20) NOT NULL AUTO_INCREMENT,
    type varchar(50) NOT NULL,
    level varchar(20) NOT NULL DEFAULT 'info',
    message text NOT NULL,
    context longtext,
    user_id bigint(20) DEFAULT NULL,
    ip_address varchar(45),
    user_agent text,
    file varchar(255),
    line int(11),
    timestamp datetime NOT NULL,
    PRIMARY KEY (id),
    KEY type_timestamp (type, timestamp),
    KEY user_timestamp (user_id, timestamp)
);
```

### Integration Points

#### Existing Code Integration:
1. **API Calls** - Enhance TradePress_API_Logging to use new logger
2. **Form Processing** - Add logging to TradePress_Listener
3. **CRON Jobs** - Add logging to all scheduled tasks
4. **Error Handling** - Replace error_log() calls with TradePress_Logger::error()
5. **User Actions** - Add logging to admin page interactions

#### WordPress Integration:
```php
// Hook into WordPress actions
add_action('wp_login', 'tradepress_log_user_login');
add_action('admin_init', 'tradepress_log_admin_access');
add_action('wp_ajax_*', 'tradepress_log_ajax_calls');
```

### Performance Considerations

#### Log Rotation:
- Daily rotation for high-volume logs
- Weekly rotation for user logs
- Monthly archival of old logs
- Configurable retention periods

#### Optimization:
- Asynchronous logging for performance
- Batch database writes
- Log level filtering
- Conditional logging based on settings

### Diagnostic Features

#### Interactive Log Viewer:
- Real-time log tailing
- Advanced filtering (date, type, user, level)
- Search functionality
- Export capabilities
- Visual timeline of events

#### Health Monitoring:
- Automation process health checks
- Error rate monitoring
- Performance trend analysis
- Alert thresholds

#### Debug Tools:
- Stack trace logging
- Variable dumping
- Query logging
- Memory usage tracking

### Migration Strategy

#### Phase 1 (Week 1):
- Create TradePress_Logger class
- Implement basic file logging
- Add settings interface

#### Phase 2 (Week 2):
- Database table creation
- Enhanced logging methods
- Integration with existing API logging

#### Phase 3 (Week 3):
- User action logging implementation
- Automation logging integration
- CRON job logging

#### Phase 4 (Week 4):
- Diagnostic dashboard
- Log viewer interface
- Performance optimization

### Success Metrics

- **Reduced debug.log usage** by 80%
- **Improved debugging efficiency** - faster issue identification
- **Better user behavior insights** - track feature usage
- **Enhanced automation monitoring** - proactive issue detection
- **Comprehensive audit trail** - full activity tracking

### File Structure
```
includes/logging/
├── tradepress-logger.php
├── tradepress-log-handler.php
├── tradepress-log-viewer.php
└── handlers/
    ├── file-handler.php
    ├── database-handler.php
    └── email-handler.php

admin/page/development/view/
├── log-viewer.php (enhanced)
└── diagnostics.php (new)

logs/
├── automation.log
├── user.log
├── error.log
└── debug.log
```

This enhanced logging system will provide comprehensive visibility into TradePress operations while maintaining performance and offering granular control over what gets logged.
