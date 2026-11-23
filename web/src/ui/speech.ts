// Spoken cues with the browser's built-in voice: on the device, so there is no network delay.

export class Voice {
  enabled = true;
  private lastFaultAt = 0;

  say(text: string, kind: 'count' | 'fault') {
    if (!this.enabled || typeof speechSynthesis === 'undefined') return;
    const now = performance.now();
    if (kind === 'fault') {
      // A correction replaces whatever is being said, but not more often than every 1.5 s.
      if (now - this.lastFaultAt < 1500) return;
      this.lastFaultAt = now;
      speechSynthesis.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.1;
    speechSynthesis.speak(u);
  }

  /** Mobile browsers only allow speech after a user gesture; call this from a tap. */
  unlock() {
    if (typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance('');
    speechSynthesis.speak(u);
  }
}
