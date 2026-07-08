import { fromBase64, toBase64 } from './base64';

// 規格偏好 Argon2id，但 Web Crypto API 沒有原生 Argon2，引入 WASM 庫會讓
// 離線解密工具（單檔 HTML、零依賴）無法成立。依 CLAUDE.md 的 fallback 路徑
// 採 PBKDF2 ≥ 600k iterations。algorithm 欄位保留演進空間。
export interface KdfParams {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  salt: string; // base64；salt 不是秘密
}

export const DEFAULT_KDF_ITERATIONS = 600_000;

export function createKdfParams(
  iterations: number = DEFAULT_KDF_ITERATIONS,
): KdfParams {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { algorithm: 'PBKDF2-SHA256', iterations, salt: toBase64(salt) };
}

export async function deriveKey(
  passphrase: string,
  params: KdfParams,
): Promise<CryptoKey> {
  if (params.algorithm !== 'PBKDF2-SHA256') {
    throw new Error(`不支援的 KDF 演算法：${params.algorithm}`);
  }
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(params.salt) as BufferSource,
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false, // 金鑰不可匯出，只存在記憶體
    ['encrypt', 'decrypt'],
  );
}
