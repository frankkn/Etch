// 分享連結 slug：不可猜測的隨機鑰匙，不是可搜尋的門牌。
// 58 字元字母表（去掉易混淆的 0/O/1/l/I）× 12 位 ≈ 70 bits 熵。
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateSlug(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export const SLUG_PATTERN = /^\/s\/([A-Za-z0-9]+)\/?$/;
