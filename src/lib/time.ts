const DAY_MS = 86_400_000;

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function gapDays(earlierIso: string, laterIso: string): number {
  return Math.floor(
    (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / DAY_MS,
  );
}

export function silenceLabel(days: number): string {
  if (days < 30) return `沉默了 ${days} 天`;
  if (days < 365) return `沉默了 ${Math.round(days / 30)} 個月`;
  const years = Math.floor(days / 365);
  const months = Math.round((days % 365) / 30);
  return months > 0 ? `沉默了 ${years} 年 ${months} 個月` : `沉默了 ${years} 年`;
}

export function countdownLabel(ms: number): string {
  const totalMinutes = Math.ceil(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`;
}
