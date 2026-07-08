/**
 * contentHash：內容不變性的錨點（規格見 CLAUDE.md 加密層）。
 * 發布時計算、可塑期內隨編輯更新、定形後不可變；
 * 日後 Reveal 上傳的明文必須與它相符，防止「藉切換可見性偷改內容」。
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
