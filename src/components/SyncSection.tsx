import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  cloudHasData,
  pushAll,
  restoreAll,
  unlockSync,
} from '../sync/engine';
import { auth, signInWithGoogle, signOutUser } from '../sync/firebase';
import { getSessionKey, setSessionKey } from '../sync/keySession';
import { getKdfParams, getKcv } from '../storage/db';
import { PassphraseDialog } from './PassphraseDialog';

type Dialog = 'none' | 'unlock' | 'restore';

/**
 * 帳號與同步。登入只負責「你是誰」；內容解密靠通關密語，兩者刻意分離。
 */
export function SyncSection({
  storeEmpty,
  onRestored,
}: {
  storeEmpty: boolean;
  onRestored: () => Promise<void>;
}) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [hasCloud, setHasCloud] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(getSessionKey() !== null);
  const [firstTime, setFirstTime] = useState(false);
  const [dialog, setDialog] = useState<Dialog>('none');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) {
      setHasCloud(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [cloud, kdf, kcv] = await Promise.all([
        cloudHasData().catch(() => null),
        getKdfParams(),
        getKcv(),
      ]);
      if (cancelled) return;
      setHasCloud(cloud);
      setFirstTime(!cloud && !kdf && !kcv); // 哪裡都沒有密語紀錄 → 首次設定
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const runSync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await pushAll());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="mb-2 text-base text-stone-100">帳號與同步</h2>
      {!user ? (
        <>
          <p className="mb-3 leading-relaxed text-stone-500">
            登入只負責「你是誰」，讓密文可以備份到雲端、在新裝置還原。內容的解密永遠靠你的通關密語——伺服器只存密文，
            <span className="text-stone-400">連我們都讀不到</span>。
          </p>
          <button
            onClick={() => void signInWithGoogle().catch((e) => setMessage(String(e)))}
            className="rounded border border-stone-600 px-5 py-2 text-stone-100 hover:bg-stone-800"
          >
            使用 Google 登入
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-stone-400">
            {user.email}
            <button
              onClick={() => {
                setSessionKey(null); // 登出順便清掉記憶體中的金鑰
                setUnlocked(false);
                void signOutUser();
              }}
              className="ml-3 text-xs text-stone-600 underline hover:text-stone-400"
            >
              登出
            </button>
          </p>

          {storeEmpty && hasCloud ? (
            <>
              <p className="leading-relaxed text-stone-500">
                雲端有這個帳號的備份。輸入通關密語，把你的一生拉回這台裝置。
              </p>
              <button
                onClick={() => setDialog('restore')}
                className="rounded border border-stone-500 px-5 py-2 text-stone-100 hover:bg-stone-800"
              >
                從雲端還原
              </button>
            </>
          ) : !unlocked ? (
            <>
              <p className="leading-relaxed text-stone-500">
                {firstTime
                  ? '設定通關密語後即可開始同步。密語用來加密雲端備份，與登入密碼無關。'
                  : '輸入通關密語解鎖同步。金鑰只存在記憶體，關閉分頁即消失。'}
              </p>
              <button
                onClick={() => setDialog('unlock')}
                className="rounded border border-stone-600 px-5 py-2 text-stone-100 hover:bg-stone-800"
              >
                {firstTime ? '設定密語並開始同步' : '解鎖同步'}
              </button>
            </>
          ) : (
            <>
              <p className="text-stone-500">
                同步已解鎖。每次變動後會自動推送，也可以手動同步。
              </p>
              <button
                disabled={busy}
                onClick={() => void runSync()}
                className="rounded border border-stone-600 px-5 py-2 text-stone-100 hover:bg-stone-800 disabled:opacity-40"
              >
                {busy ? '同步中⋯' : '立即同步'}
              </button>
            </>
          )}
        </div>
      )}
      {message && <p className="mt-3 text-stone-300">{message}</p>}

      {dialog === 'unlock' && (
        <PassphraseDialog
          mode={firstTime ? 'set' : 'unlock'}
          title={firstTime ? '設定通關密語' : '輸入通關密語'}
          busyLabel="驗證中⋯"
          onSubmit={async (pass) => {
            await unlockSync(pass);
            setUnlocked(true);
            setDialog('none');
            await runSync();
          }}
          onClose={() => setDialog('none')}
        />
      )}
      {dialog === 'restore' && (
        <PassphraseDialog
          mode="unlock"
          title="輸入通關密語以還原"
          busyLabel="解密中⋯"
          onSubmit={async (pass) => {
            const result = await restoreAll(pass);
            setUnlocked(true);
            setDialog('none');
            setMessage(result);
            await onRestored();
          }}
          onClose={() => setDialog('none')}
        />
      )}
    </section>
  );
}
