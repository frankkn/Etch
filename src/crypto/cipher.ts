import { fromBase64, toBase64 } from './base64';

export interface EncryptedBlob {
  ciphertext: string; // base64，含 GCM 認證標籤（附在尾端，Web Crypto 預設）
  iv: string; // base64，每次加密隨機產生，12 bytes
}

export async function encryptText(
  key: CryptoKey,
  plaintext: string,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(ct)), iv: toBase64(iv) };
}

export async function decryptText(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv) as BufferSource },
    key,
    fromBase64(blob.ciphertext) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}
