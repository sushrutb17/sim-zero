import type { WorldCue } from '../contracts/events';
export const CREW_CAPTION_MS = 6000;
export const CREW_CAPTION_HEAD = 'FIRST OFFICER';
/** App-clock caption lifetime, independent of audio and scenario time. */
export class CrewCaption {
  private text: string | null = null;
  private shownAt = 0;
  apply(cue: WorldCue, nowMs: number): void {
    if (cue.kind !== 'message' || cue.channel !== 'crew') return;
    this.text = cue.text;
    this.shownAt = nowMs;
  }
  current(nowMs: number): string | null {
    return nowMs < this.shownAt + CREW_CAPTION_MS ? this.text : null;
  }
  reset(): void { this.text = null; }
}
