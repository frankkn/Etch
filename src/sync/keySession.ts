// 通關密語導出的金鑰只存在記憶體，關閉分頁即消失——永不落地、永不上傳。
let sessionKey: CryptoKey | null = null;

export function getSessionKey(): CryptoKey | null {
  return sessionKey;
}

export function setSessionKey(key: CryptoKey | null): void {
  sessionKey = key;
}
