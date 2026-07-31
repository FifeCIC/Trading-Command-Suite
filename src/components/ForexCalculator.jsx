/**
 * Forex Position & Risk Calculator
 * ================================
 * Interactive slider-based calculator for forex position sizing, margin,
 * leverage, and risk analysis. Converts Tailwind to TCS design system.
 */

import { useState } from 'react';

function SliderGroup({ label, value, min, max, step, format, marks }) {
  return (
    <div className="calc-slider-group">
      <div className="calc-slider-header">
        <span>{label}</span>
        <strong>{typeof format === 'function' ? format(value) : value}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          e.target.style.setProperty('--slider-pct', `${((v - min) / (max - min)) * 100}%`);
        }}
        className="calc-slider"
      />
      {marks && (
        <div className="calc-slider-marks">
          {marks.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, warn }) {
  return (
    <div className={`calc-stat ${warn ? 'calc-stat--warn' : ''}`}>
      <span className="calc-stat-label">{label}</span>
      <span className="calc-stat-value">{value}</span>
    </div>
  );
}

export default function ForexCalculator() {
  const [balance, setBalance] = useState(1000);
  const [leverage, setLeverage] = useState(10);
  const [lotSize, setLotSize] = useState(0.1);
  const [stopLossPips, setStopLossPips] = useState(30);

  const positionUnits = lotSize * 100000;
  const requiredMargin = positionUnits / leverage;
  const freeMargin = balance - requiredMargin;
  const pipValue = lotSize * 10;
  const totalRiskAmount = stopLossPips * pipValue;
  const riskPercentage = (totalRiskAmount / balance) * 100;
  const effectiveLeverage = positionUnits / balance;

  const getRiskStatus = () => {
    if (requiredMargin > balance) {
      return { text: 'INSUFFICIENT MARGIN — REDUCE POSITION', cls: 'calc-status--critical' };
    }
    if (riskPercentage <= 2) {
      return { text: 'SAFE RISK LEVEL (CONSERVATIVE)', cls: 'calc-status--safe' };
    }
    if (riskPercentage <= 5) {
      return { text: 'MODERATE RISK', cls: 'calc-status--moderate' };
    }
    return { text: 'HIGH RISK — REDUCE SIZE OR WIDEN STOP', cls: 'calc-status--danger' };
  };

  const status = getRiskStatus();

  const lotLabel = lotSize === 0.01 ? 'Micro Lot' : lotSize === 0.1 ? 'Mini Lot' : lotSize >= 1 ? `${lotSize.toFixed(1)} Standard` : '';

  return (
    <div className="calc-grid">
      <div className="calc-inputs calc-inputs--wide">
        {/* Risk Status Banner */}
        <div className={`calc-status ${status.cls}`}>{status.text}</div>

        <SliderGroup
          label="Account Balance"
          value={balance}
          min={100}
          max={10000}
          step={100}
          format={(v) => `$${v.toLocaleString()}`}
          marks={['$100', '$2,500', '$5,000', '$10,000']}
        />

        <SliderGroup
          label="Account Leverage"
          value={leverage}
          min={1}
          max={100}
          step={1}
          format={(v) => `${v}:1`}
          marks={['1:1', '10:1', '30:1', '100:1']}
        />

        <SliderGroup
          label="Position Size"
          value={lotSize}
          min={0.01}
          max={1.0}
          step={0.01}
          format={(v) => `${v.toFixed(2)} ${lotLabel}`}
          marks={['0.01', '0.25', '0.50', '1.00']}
        />

        <SliderGroup
          label="Stop Loss Distance"
          value={stopLossPips}
          min={5}
          max={100}
          step={5}
          format={(v) => `${v} Pips`}
          marks={['5', '30', '60', '100']}
        />
      </div>

      {/* Output Metrics */}
      <div className="calc-results calc-results--grid">
        <StatBox label="Position Value" value={`$${positionUnits.toLocaleString()}`} />
        <StatBox label="Required Margin" value={`$${requiredMargin.toFixed(2)}`} warn={requiredMargin > balance} />
        <StatBox label="Free Margin" value={`$${freeMargin < 0 ? '0.00' : freeMargin.toFixed(2)}`} />
        <StatBox label="Effective Leverage" value={`${effectiveLeverage.toFixed(1)}:1`} />
        <StatBox label="Pip Value" value={`$${pipValue.toFixed(2)} / pip`} />
        <StatBox label="Dollar Risk (SL)" value={`$${totalRiskAmount.toFixed(2)} (${riskPercentage.toFixed(1)}%)`} warn={riskPercentage > 5} />
      </div>
    </div>
  );
}
