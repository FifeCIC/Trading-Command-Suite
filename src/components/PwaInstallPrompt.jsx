import { useState, useEffect, useCallback } from 'react';
import './PwaInstallPrompt.css';

/**
 * PWA Install Prompt Banner
 *
 * Shows an "Add to Home Screen" banner after certain criteria are met:
 * - User has visited at least 3 times (tracked via localStorage)
 * - App is not already installed
 * - BeforeInstallPrompt event is available
 *
 * Also shows the current install state in settings.
 */
export default function PwaInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check if already installed (display-mode: standalone)
  const checkInstalled = useCallback(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
    setIsInstalled(isStandalone);
  }, []);

  useEffect(() => {
    checkInstalled();
    window.addEventListener('appinstalled', checkInstalled);

    // Track visit count
    const visits = parseInt(localStorage.getItem('tcs_visits') || '0', 10);
    localStorage.setItem('tcs_visits', String(visits + 1));

    // Handle beforeinstallprompt event
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);

      // Show banner after 3rd visit, not already installed, not dismissed
      if (visits >= 2 && !isInstalled && !dismissed) {
        setTimeout(() => setShowBanner(true), 3000);
      }
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('appinstalled', checkInstalled);
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, [checkInstalled, isInstalled, dismissed]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;
    if (result.outcome === 'accepted') {
      setShowBanner(false);
      setIsInstalled(true);
      localStorage.setItem('tcs_installed', 'true');
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    setDismissed(true);
    localStorage.setItem('tcs_install_dismissed', 'true');
  };

  if (isInstalled || !showBanner) return null;

  return (
    <div className="pwa-install-banner" role="alert">
      <div className="pwa-install-content">
        <div className="pwa-install-icon">📲</div>
        <div className="pwa-install-text">
          <strong>Install TradeCS</strong>
          <span className="pwa-install-sub">Add to home screen for quick access</span>
        </div>
        <div className="pwa-install-actions">
          <button className="pwa-install-btn" onClick={handleInstall}>
            Install
          </button>
          <button className="pwa-install-dismiss" onClick={handleDismiss} aria-label="Dismiss">
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
