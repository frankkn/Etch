export const QUOTA_TOTAL = 100;
// 可塑期：發布後可編輯/刪除的窗口，錨定發布時間，編輯不重置。
// 期滿即定形：定形時刻 = etchedAt + 24h，純時間比較，不需要任何排程。
export const MALLEABLE_WINDOW_MS = 24 * 60 * 60 * 1000;
