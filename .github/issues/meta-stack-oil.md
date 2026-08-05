## Market Area: Oil (Crude)

**Symbols:** USOIL (WTI), UKOIL (Brent), XTIUSD

Oil is the third pillar of macro trading alongside gold and indices:
- CAD-correlated (already have cad-crosses-v1 protocol)
- Sensitive to geopolitics, OPEC, inventory data
- Strong momentum during NY session
- Mean-reverting characteristics within ranges

### Needed
- **Protocol:** `oil-macro-v1` — WTI + Brent, inventory cycle overlay, CAD correlation check
- **Scoring Strategy:** Gates on CAD correlation + macro confirmation
- **Trading Strategy:** MT5 CFD execution

### Related
- #540 cad-crosses-v1 (already created — CAD pairs correlate with oil)
