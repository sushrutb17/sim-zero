/**
 * Build stamp: when this bundle was built and from which commit (vite.config.ts `define`). Shown on the welcome
 * screen and on the 2D page, so a tester can tell which version a headset is showing. No IWSDK or DOM imports:
 * tested in node, where the define does not exist and the stamp reads "Build unknown".
 */
declare const __BUILD_INFO__: BuildInfo | undefined;

export interface BuildInfo {
  /** ISO 8601 build time. */
  time: string;
  /** Short commit id, or 'local' when the build had no Git checkout. */
  commit: string;
}

export const BUILD_INFO: BuildInfo | null = typeof __BUILD_INFO__ !== 'undefined' && __BUILD_INFO__ ? __BUILD_INFO__ : null;

export interface StampOptions {
  locale?: string;
  /** IANA zone; the viewer's own zone when omitted. */
  timeZone?: string;
  /** Append the commit id (default true). The headset's welcome screen leaves it out (T49); the 2D page footer keeps it. */
  commit?: boolean;
}

/** "Build Nov 15, 4:42 PM · 7721119", in the viewer's local time; with `commit: false`, "Build Nov 15, 4:42 PM". */
export function formatBuildStamp(info: BuildInfo | null = BUILD_INFO, opts: StampOptions = {}): string {
  if (!info) return 'Build unknown';
  const at = new Date(info.time);
  const withCommit = opts.commit !== false;
  if (Number.isNaN(at.getTime())) return withCommit ? `Build ${info.commit}` : 'Build unknown';
  const when = new Intl.DateTimeFormat(opts.locale ?? 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: opts.timeZone }).format(at);
  return withCommit ? `Build ${when} · ${info.commit}` : `Build ${when}`;
}
