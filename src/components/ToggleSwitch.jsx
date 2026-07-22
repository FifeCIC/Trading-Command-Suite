/**
 * ToggleSwitch — Reusable toggle component.
 * Replaces checkbox-hack toggles across the app.
 *
 * Usage:
 *   <ToggleSwitch checked={value} onChange={setValue} />
 *   <ToggleSwitch checked={value} onChange={setValue} label="Trading" />
 *   <ToggleSwitch checked={value} onChange={setValue} sm />
 *
 * @see #462 Automation Dashboard modernization
 */

import './toggle-switch.css';

export default function ToggleSwitch({ checked, onChange, label, sm, disabled }) {
  return (
    <label className={`ts-toggle${sm ? ' ts-sm' : ''}${disabled ? ' ts-disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
      />
      <span className="ts-slider" />
      {label && <span className="ts-label">{label}</span>}
    </label>
  );
}
