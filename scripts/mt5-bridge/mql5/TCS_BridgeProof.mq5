//+------------------------------------------------------------------+
//|                                              TCS_BridgeProof.mq5 |
//|      Trading Command Suite — packaging feasibility proof (#808) |
//+------------------------------------------------------------------+
//| WHAT THIS PROVES, AND WHY IT IS THE FIRST THING TO PROVE          |
//|                                                                    |
//| Issue #808 recommends shape A: ship the existing stack as a        |
//| Windows desktop app, with a thin MQL5 EA acting as the bridge to   |
//| the MetaTrader 5 terminal. The whole commercial shape rests on one |
//| unmeasured assumption:                                                 |
//|                                                                    |
//|     "An EA running inside the terminal can reach the local         |
//|      NestJS API over HTTP and read a score back."                  |
//|                                                                    |
//| If that is false, shape A is dead and packaging work is wasted.     |
//| So this EA does the smallest possible version of it: asks the API   |
//| for one symbol's score, prints it, and prints a NAMED reason when   |
//| it cannot.                                                          |
//|                                                                    |
//| ⚠️ IT PLACES NO ORDERS AND TOUCHES NO ACCOUNT STATE. Read-only.     |
//|                                                                    |
//| PREREQUISITE THAT IS NOT OPTIONAL                                   |
//|   MetaTrader 5 blocks outbound HTTP from an EA unless the URL is    |
//|   explicitly listed. Without it WebRequest() returns -1 with error  |
//|   4060 and nothing else happens — the classic "plausible nothing".  |
//|                                                                    |
//|     Tools → Options → Expert Advisors                               |
//|       [x] Allow WebRequest for listed URL                           |
//|       [+] http://localhost:3201                                     |
//|                                                                    |
//|   ⚠️ Add the exact host you use in InpBaseUrl. `localhost` and       |
//|   `127.0.0.1` are DIFFERENT entries in that list.                   |
//|                                                                    |
//| HOW TO RUN                                                          |
//|   1. Start the API (npm --prefix nest run start:dev) and confirm    |
//|      curl http://localhost:3201/api/health returns status ok.       |
//|   2. MQL5 → MetaEditor → open this file → F7 to compile.            |
//|   3. Drag onto any chart. Algo Trading may be off — this EA reads   |
//|      only, and WebRequest does not need it.                         |
//|   4. Watch the Experts tab. It polls every InpIntervalSec.          |
//+------------------------------------------------------------------+
#property copyright "Ryan Bayne / FifeCIC"
#property version   "1.00"
#property description "Read-only proof that an EA can call the local TCS API and read a score."

//--- inputs
input string InpBaseUrl      = "http://localhost:3201"; // API base URL (must be in the WebRequest allow-list)
input string InpSymbol       = "";                      // Ticker to score. Empty = the chart symbol
input int    InpIntervalSec  = 5;                       // Poll interval, seconds
input int    InpTimeoutMs    = 5000;                     // WebRequest timeout

//--- state
string g_url      = "";
string g_lastLine = "";

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpIntervalSec < 1)
     {
      Print("[TCS] InpIntervalSec must be >= 1.");
      return(INIT_PARAMETERS_INCORRECT);
     }

   ResetLastError();
   EventSetTimer(InpIntervalSec);
   if(GetLastError() != 0)
     {
      Print("[TCS] EventSetTimer failed. The EA will not poll.");
      return(INIT_FAILED);
     }

   string ticker = (StringLen(InpSymbol) > 0) ? InpSymbol : _Symbol;
   g_url = InpBaseUrl + "/api/scoring/breakdown/" + ticker;

   PrintFormat("[TCS] Proof EA started. ticker=%s  url=%s  every %ds",
               ticker, g_url, InpIntervalSec);
   Print("[TCS] If the first poll reports error 4060, the URL is not in "
         "Tools → Options → Expert Advisors → Allow WebRequest for listed URL.");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   Comment("");
  }

//+------------------------------------------------------------------+
//| Poll is on a timer, not on ticks: a proof must not depend on      |
//| the market being open, and a closed market would look like a      |
//| broken bridge.                                                    |
//+------------------------------------------------------------------+
void OnTimer()
  {
   char   data[];        // empty body — GET
   char   result[];
   string headers = "";

   ResetLastError();
   int status = WebRequest("GET", g_url, "", "", InpTimeoutMs,
                           data, 0, result, headers);

   if(status == -1)
     {
      int err = GetLastError();
      PrintFormat("[TCS] WebRequest failed: %s", WebRequestRemedy(err));
      return;
     }

   if(status != 200)
     {
      PrintFormat("[TCS] API answered HTTP %d — the route exists but did not "
                  "return a score. Check the ticker: %s", status, g_url);
      return;
     }

   string body = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
   string score = JsonNumber(body, "score");

   if(StringLen(score) == 0)
     {
      // ⚠️ The failure that matters. A 200 with no score is not success — it is
      // the "plausible output, no error" shape. Say so rather than printing 0.
      Print("[TCS] FAIL: HTTP 200 but no \"score\" field in the response. "
            "This is NOT a pass. First 200 chars: " + StringSubstr(body, 0, 200));
      return;
     }

   g_lastLine = StringFormat("TCS score for %s = %s  (%s)",
                             ((StringLen(InpSymbol) > 0) ? InpSymbol : _Symbol),
                             score, TimeToString(TimeLocal(), TIME_MINUTES));
   Comment(g_lastLine);
   PrintFormat("[TCS] PASS: %s", g_lastLine);
  }

//+------------------------------------------------------------------+
//| The error codes that actually happen, with the fix appended.      |
//| A bare number in a log is a puzzle; a number plus a remedy is a    |
//| result.                                                            |
//+------------------------------------------------------------------+
string WebRequestRemedy(int err)
  {
   switch(err)
     {
      case 4060: return("4060 — URL not allowed. Tools→Options→Expert Advisors→"
                        "'Allow WebRequest for listed URL', and add EXACTLY: " + InpBaseUrl);
      case 5203: return("5203 — server rejected the request. Is the API running? "
                        "Try: curl http://localhost:3201/api/health");
      case 5200: return("5200 — invalid URL. Check InpBaseUrl for a trailing slash.");
      case 4014: return("4014 — function not allowed. Enable 'Allow WebRequest' "
                        "and re-attach the EA.");
      case 5273: return("5273 — invalid HTTP method or header.");
      default:   return(StringFormat("%d — see MQL5 WebRequest error codes", err));
     }
  }

//+------------------------------------------------------------------+
//| Minimal JSON number reader. Deliberately not a parser: the proof  |
//| needs one field from a flat-ish object, and a hand-rolled parser  |
//| would be the thing most likely to be wrong.                       |
//|                                                                    |
//| ⚠️ Returns "" when the key is absent, so the caller can tell       |
//| "no score" from "score 0". Those are different facts.             |
//+------------------------------------------------------------------+
string JsonNumber(const string src, const string key)
  {
   string needle = "\"" + key + "\"";
   int at = StringFind(src, needle);
   if(at < 0) return("");

   int colon = StringFind(src, ":", at + StringLen(needle));
   if(colon < 0) return("");

   int i = colon + 1;
   int len = StringLen(src);
   // skip whitespace
   while(i < len)
     {
      ushort c = StringGetCharacter(src, i);
      if(c != ' ' && c != '\t' && c != '\r' && c != '\n') break;
      i++;
     }

   int start = i;
   while(i < len)
     {
      ushort c = StringGetCharacter(src, i);
      if((c >= '0' && c <= '9') || c == '-' || c == '.' || c == '+' || c == 'e' || c == 'E')
         i++;
      else
         break;
     }

   if(i <= start) return("");
   return(StringSubstr(src, start, i - start));
  }
//+------------------------------------------------------------------+
