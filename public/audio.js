// Audio module for sound effects using Web Audio API.
const audio = {
  ctx: null,
  bgInterval: null,

  init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
  },

  playTone(frequency, duration, type = 'sine') {
    if (!state.soundEnabled || !this.ctx) return;

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.frequency.value = frequency;
      osc.type = type;

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + duration);

      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      // Ignore audio errors silently.
    }
  },

  // Correct answer: ascending chord (success tone).
  playCorrect() {
    this.playTone(523, 0.15);
    setTimeout(() => this.playTone(659, 0.15), 100);
    setTimeout(() => this.playTone(784, 0.2), 200);
  },

  // Wrong answer: descending tone (failure tone).
  playWrong() {
    this.playTone(330, 0.1);
    setTimeout(() => this.playTone(220, 0.2), 100);
  },

  // Round end notification: double beep.
  playRoundEnd() {
    this.playTone(440, 0.1);
    setTimeout(() => this.playTone(440, 0.1), 120);
  },

  // Game start: ascending arpeggio.
  playGameStart() {
    this.playTone(330, 0.1);
    setTimeout(() => this.playTone(440, 0.1), 100);
    setTimeout(() => this.playTone(550, 0.15), 200);
  },

  // Soft looping background melody while playing.
  startBackground() {
    if (!state.soundEnabled || !this.ctx || this.bgInterval) return;

    const sequence = [262, 330, 392, 330];
    let step = 0;

    this.bgInterval = setInterval(() => {
      if (!state.soundEnabled || !this.ctx) return;
      this.playTone(sequence[step % sequence.length], 0.22, 'triangle');
      step += 1;
    }, 900);
  },

  stopBackground() {
    if (this.bgInterval) {
      clearInterval(this.bgInterval);
      this.bgInterval = null;
    }
  },

  toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    localStorage.setItem('soundEnabled', state.soundEnabled);

    if (!state.soundEnabled) {
      this.stopBackground();
    } else {
      const questionScreen = $('screen-question');
      if (questionScreen && !questionScreen.classList.contains('hidden')) {
        this.startBackground();
      }
    }

    updateSoundButton();
  },
};

function updateSoundButton() {
  const btn = $('btn-sound-toggle');
  if (btn) {
    btn.textContent = state.soundEnabled ? '🔊 Sonido' : '🔇 Mudo';
    btn.className = state.soundEnabled ? 'sound-btn' : 'sound-btn muted';
  }
}
