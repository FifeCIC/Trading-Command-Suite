import { Injectable, Logger } from '@nestjs/common';

/**
 * IANA timezone-aware service.
 * Replaces hardcoded UTC offsets with proper DST-aware timezone resolution.
 */
@Injectable()
export class TimezoneService {
  private readonly logger = new Logger(TimezoneService.name);

  // Major trading timezones (used as fallback when Intl API unavailable)
  static readonly TRADING_TIMEZONES: Record<string, { label: string; iana: string }> = {
    ny:     { label: 'New York (US Equities)', iana: 'America/New_York' },
    london: { label: 'London (Forex/FTSE)',     iana: 'Europe/London' },
    tokyo:  { label: 'Tokyo (Asia/Nikkei)',     iana: 'Asia/Tokyo' },
    sydney: { label: 'Sydney (ASX)',             iana: 'Australia/Sydney' },
    zurich: { label: 'Zurich (Forex)',           iana: 'Europe/Zurich' },
    hongkong: { label: 'Hong Kong (Hang Seng)',  iana: 'Asia/Hong_Kong' },
  };

  /**
   * Check if the current time in a given timezone falls within a window.
   */
  isInWindow(
    iana: string,
    start: string,
    end: string,
    daysOfWeek?: number[],
  ): boolean {
    try {
      const now = new Date();
      const tzString = now.toLocaleString('en-US', { timeZone: iana });
      const tzDate = new Date(tzString);

      const day = tzDate.getDay(); // 0=Sun, 1=Mon
      if (daysOfWeek && !daysOfWeek.includes(day)) return false;

      const hours = tzDate.getHours();
      const minutes = tzDate.getMinutes();
      const currentMinutes = hours * 60 + minutes;

      const [startH, startM] = start.split(':').map(Number);
      const [endH, endM] = end.split(':').map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    } catch {
      this.logger.warn(`TimezoneService: failed to resolve ${iana} — returning false`);
      return false;
    }
  }

  /**
   * Get current time string in given IANA timezone.
   */
  getTimeInZone(iana: string): string {
    try {
      return new Date().toLocaleTimeString('en-US', {
        timeZone: iana,
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '00:00';
    }
  }

  /**
   * Get current hour of day in given IANA timezone.
   */
  getHourInZone(iana: string): number {
    try {
      const tzString = new Date().toLocaleString('en-US', { timeZone: iana });
      return new Date(tzString).getHours();
    } catch {
      return 0;
    }
  }

  /**
   * Get day of week (0=Sun) in given IANA timezone.
   */
  getDayInZone(iana: string): number {
    try {
      const tzString = new Date().toLocaleString('en-US', { timeZone: iana });
      return new Date(tzString).getDay();
    } catch {
      return 0;
    }
  }

  /**
   * Convert old UTC-offset-based check to IANA-based.
   * Returns the IANA equivalent of common trading timezones.
   */
  resolveTimezone(location: string): string {
    const lower = location.toLowerCase();
    if (lower.includes('ny') || lower.includes('new_york') || lower.includes('eastern')) return 'America/New_York';
    if (lower.includes('london') || lower.includes('uk')) return 'Europe/London';
    if (lower.includes('tokyo') || lower.includes('japan')) return 'Asia/Tokyo';
    if (lower.includes('sydney') || lower.includes('australia')) return 'Australia/Sydney';
    if (lower.includes('zurich') || lower.includes('swiss')) return 'Europe/Zurich';
    if (lower.includes('hong') || lower.includes('hk')) return 'Asia/Hong_Kong';
    return 'America/New_York'; // default
  }
}
