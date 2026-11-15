/**
 * supporter-targets.ts — the links a support prompt may offer.
 *
 * WHY THIS IS A MODULE AND NOT LITERALS IN A COMPONENT
 * ---------------------------------------------------
 * A URL is an EXTERNAL system (`.github/instructions/external-systems-are-data.instructions.md`), so
 * it is data: one copy, in one place, that a different deployment can change without editing a React
 * component. The PRIMARY donate destination is deliberately NOT here — it is the declared setting
 * `supporter.donate.url`, because the owner may change provider and a rebuild should not be needed.
 *
 * ⚠️ THE ORDER IS THE ASK. DONATION-LINKS.md §4: four equal buttons is a menu, not an ask. So the
 * prompt renders `donate` first, and the rest are secondary links on one quiet line.
 *
 * ⚠️ `kind` is load-bearing: only `donate` counts as a positive response for the cooldown. A user who
 * reads the support page is not a user who has given, and treating them the same would suppress the
 * next ask for someone who declined it by browsing.
 */

export type SupporterTargetKind = 'donate' | 'info' | 'community';

export interface SupporterTarget {
  id: string;
  label: string;
  url: string;
  kind: SupporterTargetKind;
  /** One short line, rendered under the label. This is a banner, not a page. */
  note: string;
}

/** This project's own public pages — a constant of THIS app, not of a user's setup. */
const SITE_SUPPORT = 'https://fifecic.github.io/Trading-Command-Suite/support/';
const DISCORD_INVITE = 'https://discord.gg/8gRFkhbbfg';

/**
 * The secondary links. The donate target is prepended by `buildTargets()` from the setting, so there
 * is exactly ONE place a donate URL can come from.
 */
export const SECONDARY_TARGETS: readonly SupporterTarget[] = [
  {
    id: 'support-page',
    label: 'All the ways to support this project',
    url: SITE_SUPPORT,
    kind: 'info',
    note: 'Sponsors, Patreon, PayPal and Buy Me a Coffee are listed together.',
  },
  {
    id: 'discord',
    label: 'Join the Discord',
    url: DISCORD_INVITE,
    kind: 'community',
    note: 'Where the work in progress is discussed.',
  },
] as const;

/**
 * Assemble the target list for one response.
 *
 * `donateUrl` comes from `supporter.donate.url`. An empty value is treated as "no donate target"
 * rather than passed through — a button with `href=""` reloads the current page, which reads as a
 * broken button and is a worse outcome than showing no donate button at all.
 */
export function buildTargets(donateUrl: string): SupporterTarget[] {
  const url = (donateUrl || '').trim();
  const donate: SupporterTarget[] = url
    ? [
        {
          id: 'donate',
          label: 'Sponsor this project',
          url,
          kind: 'donate',
          note: 'The app is free and complete. Support is voluntary.',
        },
      ]
    : [];
  return [...donate, ...SECONDARY_TARGETS];
}
