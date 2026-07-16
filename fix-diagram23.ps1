$lines = Get-Content 'c:\wamp64\www\trading-command-suite\src\pages\DiagramsPage.jsx'

$newBlock = @"
        D["Profit Factor<br/>grossProfit / grossLoss"]
        E["Max Drawdown<br/>peak - trough"]
        F["Runtime Hours<br/>activatedAt to lastTrade"]
    end
    subgraph Formula["Rating Formula"]
        G["Effectiveness Rate<br/>PnL / runtimeHours"]
        G2["Normalize<br/>min 100, eff/50 x 100"]
        H["Confidence Factor<br/>clamp trades/100, 0.1, 1.0"]
        I["Recency Decay<br/>exp -daysSinceLast/30"]
        J["Consistency Factor<br/>1 - abs winRate-0.5 x 0.3"]
        K["Composite Rating<br/>norm x decay x conf x cons"]
    end
    subgraph Output["Output"]
        L["Star Bands<br/>Elite GT 80 | Strong GT 60<br/>Average GT 40 | Weak GT 20 | Untested"]
        M["StackPerformance<br/>upsert to DB"]
        N["SHA-256 Fingerprint<br/>config drift detection"]
    end
    A --> B
    A --> C
    A --> D
    A --> E
    A --> F
    B --> G
    F --> G
    G --> G2
    C --> J
    G2 --> K
    H --> K
    I --> K
    J --> K
    K --> L
    K --> M
    A --> N

    style Inputs fill:#1e3a5f,stroke:#3b82f6,color:#e5e7eb
    style Metrics fill:#1a1a2e,stroke:#6366f1,color:#e5e7eb
    style Formula fill:#1a1a2e,stroke:#8b5cf6,color:#e5e7eb
    style Output fill:#1a1a2e,stroke:#f59e0b,color:#e5e7eb
    style A fill:#2563eb,color:#fff
    style B fill:#475569,color:#e5e7eb
    style C fill:#475569,color:#e5e7eb
    style D fill:#475569,color:#e5e7eb
    style E fill:#475569,color:#e5e7eb
    style F fill:#475569,color:#e5e7eb
    style G fill:#7c3aed,color:#fff
    style G2 fill:#7c3aed,color:#fff
    style H fill:#7c3aed,color:#fff
    style I fill:#7c3aed,color:#fff
    style J fill:#7c3aed,color:#fff
    style K fill:#a855f7,color:#fff
    style L fill:#22c55e,color:#000
    style M fill:#4ade80,color:#000
    style N fill:#f59e0b,color:#000``,
  },
"@

$newLines = $newBlock -split "`n"

# Replace lines 1166 through 1221 (0-indexed) with new content
$before = $lines[0..1165]
$after = $lines[1222..($lines.Length-1)]

$result = $before + $newLines + $after
$result | Set-Content 'c:\wamp64\www\trading-command-suite\src\pages\DiagramsPage.jsx' -Encoding UTF8
Write-Output "Done. Lines before: $($lines.Length), after: $($result.Length)"
