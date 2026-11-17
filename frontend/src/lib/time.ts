/**
 * Format a Date object into DayName and dd/mm/yyyy per MVP spec.
 */
export function formatKansoDate(date: Date = new Date()): {
  dayName: string;
  formattedDate: string;
} {
  const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return {
    dayName,
    formattedDate: `${day}/${month}/${year}`,
  };
}

/**
 * Format seconds into MM:SS (under 1 hour) or HH:MM:SS.
 */
export function formatTimerClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Compact human-readable logged duration (e.g. "25m", "1h 12m", "45s").
 */
export function formatLoggedDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  if (safe === 0) return '0m';
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/**
 * Play a gentle synthesized zen bell chime via Web Audio API when a Pomodoro phase finishes.
 */
export function playZenChime(): void {
  if (typeof window === 'undefined') return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const frequencies = [528, 792];
    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);

      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.14 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.14 + 1.4);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 1.45);
    });
  } catch {
    // Ignore autoplay audio restrictions gracefully
  }
}
