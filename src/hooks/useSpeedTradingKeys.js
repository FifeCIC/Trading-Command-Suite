import { useEffect, useCallback } from 'react';

const DEFAULTS = {
  b: 'BUY',
  s: 'SELL',
  B: 'BUY_2X',
  S: 'SELL_2X',
  c: 'CLOSE_ALL',
  C: 'CLOSE_HALF',
  x: 'CLOSE_WORST',
  z: 'REVERSE',
  '1': 'SIZE_50',
  '2': 'SIZE_100',
  '3': 'SIZE_250',
  '4': 'SIZE_500',
  '5': 'SIZE_1000',
  t: 'TOGGLE_TP',
  y: 'CYCLE_TP',
  l: 'TOGGLE_SL',
  Tab: 'CYCLE_SYMBOL',
  '`': 'CYCLE_TF',
  ArrowLeft: 'SCROLL_LEFT',
  ArrowRight: 'SCROLL_RIGHT',
  ArrowUp: 'ZOOM_IN',
  ArrowDown: 'ZOOM_OUT',
  ' ': 'PAUSE',
  Escape: 'LOCK_OUT',
  p: 'PAUSE_TRADING',
  F1: 'TOGGLE_OVERLAY',
};

const SIZE_MAP = { SIZE_50: 50, SIZE_100: 100, SIZE_250: 250, SIZE_500: 500, SIZE_1000: 1000 };

export function useSpeedTradingKeys({ active, onAction, size, setSize, locked, onToggleOverlay }) {
  const handleKey = useCallback((e) => {
    if (!active || locked) return;

    const action = DEFAULTS[e.key];
    if (!action) return;

    // Prevent browser defaults for trading keys
    if (['b','s','c','x','z','t','y','l',' ','Tab','`','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Escape','p'].includes(e.key)) {
      e.preventDefault();
    }

    // Size presets
    if (action.startsWith('SIZE_')) {
      const newSize = SIZE_MAP[action];
      if (newSize && setSize) setSize(newSize);
      if (onAction) onAction({ type: 'SIZE_CHANGE', size: newSize });
      return;
    }

    // Buy/Sell with modifier for 2x
    if (action === 'BUY' && e.shiftKey) return onAction?.({ type: 'BUY_2X', size: (size || 100) * 2 });
    if (action === 'SELL' && e.shiftKey) return onAction?.({ type: 'SELL_2X', size: (size || 100) * 2 });

    if (action === 'TOGGLE_OVERLAY') return onToggleOverlay?.();

    if (onAction) onAction({ type: action, size: size || 100 });
  }, [active, locked, size, setSize, onAction, onToggleOverlay]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  return { shortcuts: DEFAULTS };
}
