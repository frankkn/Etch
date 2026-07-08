import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  cloudHasData,
  disableShare,
  enableShare,
  getShareSlug,
  regenerateShare,
  restoreAll,
  syncNow,
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
      setMessage(await syncNow()); // 有金鑰走完整同步，沒有就只推公開內容
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
          ) : (
            <>
              {!unlocked ? (
                <>
                  <p className="leading-relaxed text-stone-500">
                    {firstTime
                      ? '設定通關密語後即可同步私密內容。密語用來加密雲端備份，與登入密碼無關。'
                      : '輸入通關密語解鎖同步。金鑰只存在記憶體，關閉分頁即消失。'}
                    公開貼文與分享連結只要登入就會同步，不需要密語。
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => setDialog('unlock')}
                      className="rounded border border-stone-600 px-5 py-2 text-stone-100 hover:bg-stone-800"
                    >
                      {firstTime ? '設定密語並開始同步' : '解鎖同步'}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void runSync()}
                      className="rounded border border-stone-700 px-5 py-2 text-stone-300 hover:bg-stone-800 disabled:opacity-40"
                    >
                      {busy ? '同步中⋯' : '同步公開內容'}
                    </button>
                  </div>
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
              <ShareLinkManager />
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

type ShareState =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'on'; slug: string };

/** 分享連結：不可猜測的隨機鑰匙。可重生（換鎖）、可停用（拆門）。 */
function ShareLinkManager() {
  const [state, setState] = useState<ShareState>({ kind: 'loading' });
  const [confirming, setConfirming] = useState<'regen' | 'off' | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    void getShareSlug()
      .then((slug) => setState(slug ? { kind: 'on', slug } : { kind: 'off' }))
      .catch(() => setState({ kind: 'off' }));
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  if (state.kind === 'loading') return null;

  const shareUrl =
    state.kind === 'on' ? `${window.location.origin}/s/${state.slug}` : null;

  return (
    <div className="mt-6 border-t border-stone-800 pt-5">
      <h3 className="mb-2 text-sm text-stone-200">分享連結</h3>
      {state.kind === 'off' ? (
        <>
          <p className="mb-3 leading-relaxed text-stone-500">
            一條不可猜測的隨機連結，只給你主動遞出去的人。訪客只看得到你選擇公開的貼文——編號、空缺與真實進度照留。
          </p>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const slug = await enableShare();
                setState({ kind: 'on', slug });
                // 立即推送一次，分享頁才不會開門見空屋
                setNote(
                  await syncNow().catch((e) =>
                    e instanceof Error ? e.message : String(e),
                  ),
                );
              })
            }
            className="rounded border border-stone-600 px-5 py-2 text-stone-100 hover:bg-stone-800 disabled:opacity-40"
          >
            產生分享連結
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <p className="break-all rounded bg-stone-950 px-3 py-2 font-mono text-xs text-stone-300">
            {shareUrl}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl!);
                setNote('已複製');
              }}
              className="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800"
            >
              複製
            </button>
            <a
              href={shareUrl!}
              target="_blank"
              rel="noreferrer"
              className="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800"
            >
              預覽
            </a>
            <button
              onClick={() => setConfirming('regen')}
              className="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-800"
            >
              重生連結
            </button>
            <button
              onClick={() => setConfirming('off')}
              className="rounded border border-stone-700 px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-800"
            >
              停用連結
            </button>
          </div>
          {confirming && (
            <div className="rounded border border-stone-700 bg-stone-900 p-3 text-xs">
              <p className="mb-2 text-stone-400">
                {confirming === 'regen'
                  ? '重生後舊連結全部失效——內容收不回，但門可以換鎖。確定？'
                  : '停用後任何人都打不開分享頁。已公開貼文的可見性不變，想收回展示請逐則 Unlist。確定？'}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirming(null)}
                  className="rounded px-3 py-1 text-stone-400 hover:text-stone-200"
                >
                  取消
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (confirming === 'regen') {
                        const slug = await regenerateShare();
                        setState({ kind: 'on', slug });
                        setNote('已換鎖，舊連結已失效');
                      } else {
                        await disableShare();
                        setState({ kind: 'off' });
                      }
                    })
                  }
                  className="rounded border border-red-900 px-3 py-1 text-red-400 hover:bg-red-950 disabled:opacity-40"
                >
                  確定
                </button>
              </div>
            </div>
          )}
          {note && <p className="text-stone-500">{note}</p>}
        </div>
      )}
    </div>
  );
}
