class SpeechEngine {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.muted = false;
    this.voice = null;
    this.unlocked = false;
    this.recentKeys = new Map();
    this.lastSpokenText = '';
    this.lastSpokenAt = 0;

    if (this.supported) {
      this._loadVoice();
      window.speechSynthesis.onvoiceschanged = () => this._loadVoice();
    }
  }

  _loadVoice() {
    if (!this.supported) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    const preferredLangs = ['es-AR', 'es-419', 'es-ES', 'es-MX', 'es-US'];
    for (const lang of preferredLangs) {
      const match = voices.find((v) => v.lang && v.lang.toLowerCase() === lang.toLowerCase());
      if (match) {
        this.voice = match;
        return;
      }
    }
    const anySpanish = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('es'));
    if (anySpanish) {
      this.voice = anySpanish;
    }
  }

  unlock() {
    if (!this.supported || this.unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      window.speechSynthesis.speak(u);
      this.unlocked = true;
    } catch {
      // Ignore unlock failures
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted && this.supported) {
      window.speechSynthesis.cancel();
    }
  }

  /**
   * Speaks a phrase with strict deduplication & cooldown so it never loops.
   */
  speak(text, { key = null, minCooldownMs = 15000, priority = 'normal' } = {}) {
    if (!this.supported || this.muted || !text) return false;

    const now = Date.now();
    const dedupKey = key || text.trim().toLowerCase();

    const prevAt = this.recentKeys.get(dedupKey);
    if (prevAt && now - prevAt < minCooldownMs) {
      return false;
    }

    // Prevent repeating the exact same sentence within 12s regardless of key
    if (text === this.lastSpokenText && now - this.lastSpokenAt < 12000) {
      return false;
    }

    if (priority === 'high') {
      window.speechSynthesis.cancel();
    } else if (window.speechSynthesis.speaking) {
      // Don't stack normal announcements into a backlog queue
      return false;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.voice?.lang || 'es-AR';
    if (this.voice) utterance.voice = this.voice;
    utterance.rate = 1.04;
    utterance.pitch = 1.0;

    this.recentKeys.set(dedupKey, now);
    this.lastSpokenText = text;
    this.lastSpokenAt = now;

    // Prune old keys occasionally
    if (this.recentKeys.size > 40) {
      for (const [k, ts] of this.recentKeys.entries()) {
        if (now - ts > 120000) this.recentKeys.delete(k);
      }
    }

    window.speechSynthesis.speak(utterance);
    return true;
  }

  resetHistory() {
    this.recentKeys.clear();
    this.lastSpokenText = '';
    this.lastSpokenAt = 0;
  }
}

export const speech = new SpeechEngine();
