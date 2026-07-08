import { useCallback, useEffect, useState } from 'react';
import { Backup } from './components/Backup';
import { Drafts } from './components/Drafts';
import { Onboarding } from './components/Onboarding';
import { Timeline } from './components/Timeline';
import { Write } from './components/Write';
import { QUOTA_TOTAL } from './lib/constants';
import { autoPushSoon } from './sync/engine';
import {
  isOnboarded,
  listDrafts,
  listPosts,
  setOnboarded as markOnboarded,
  type Draft,
  type Post,
} from './storage/db';

export type View = 'timeline' | 'write' | 'drafts' | 'backup';

type Editing =
  | { kind: 'draft'; id: string }
  | { kind: 'post'; id: string }
  | null;

const NAV: Array<{ view: View; label: string }> = [
  { view: 'timeline', label: '時間軸' },
  { view: 'write', label: '寫作' },
  { view: 'drafts', label: '草稿' },
  { view: 'backup', label: '備份' },
];

export default function App() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [onboarded, setOnboardedState] = useState<boolean | null>(null);
  const [view, setView] = useState<View>('timeline');
  const [editing, setEditing] = useState<Editing>(null);

  const refresh = useCallback(async () => {
    // 定形是純時間比較（etchedAt + 24h），不需要任何排程或狀態轉移
    const [p, d, ob] = await Promise.all([listPosts(), listDrafts(), isOnboarded()]);
    setPosts(p);
    setDrafts(d);
    setOnboardedState(ob);
    autoPushSoon(); // 已登入且已解鎖時，本地變動後輕輕推一把雲端鏡像
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (onboarded === null) return null;

  if (!onboarded) {
    return (
      <Onboarding
        onDone={async () => {
          await markOnboarded();
          await refresh();
        }}
      />
    );
  }

  const quotaUsed = posts.length; // 額度 = 現存貼文數，含可塑期中的

  const editingTarget =
    editing?.kind === 'draft'
      ? { kind: 'draft' as const, draft: drafts.find((d) => d.id === editing.id)! }
      : editing?.kind === 'post'
        ? { kind: 'post' as const, post: posts.find((p) => p.id === editing.id)! }
        : { kind: 'new' as const };

  const finish = async (dest: View) => {
    setEditing(null);
    await refresh();
    setView(dest);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4">
      <header className="flex items-baseline justify-between border-b border-stone-800 py-5">
        <h1 className="text-xl font-semibold tracking-[0.3em] text-stone-100">
          ETCH
        </h1>
        <span className="text-sm tabular-nums text-stone-500">
          {quotaUsed} / {QUOTA_TOTAL}
        </span>
      </header>

      <nav className="flex gap-1 border-b border-stone-800 py-2 text-sm">
        {NAV.map(({ view: v, label }) => (
          <button
            key={v}
            onClick={() => {
              if (v === 'write') setEditing(null);
              setView(v);
            }}
            className={`rounded px-3 py-1.5 transition-colors ${
              view === v
                ? 'bg-stone-800 text-stone-100'
                : 'text-stone-500 hover:text-stone-300'
            }`}
          >
            {label}
            {v === 'drafts' && drafts.length > 0 && (
              <span className="ml-1.5 text-xs text-stone-600">
                {drafts.length}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main className="flex-1 py-8">
        {view === 'timeline' && (
          <Timeline
            posts={posts}
            onChanged={refresh}
            onEditPost={(id) => {
              setEditing({ kind: 'post', id });
              setView('write');
            }}
          />
        )}
        {view === 'write' && (
          <Write target={editingTarget} quotaUsed={quotaUsed} onDone={finish} />
        )}
        {view === 'drafts' && (
          <Drafts
            drafts={drafts}
            quotaUsed={quotaUsed}
            onEdit={(id) => {
              setEditing({ kind: 'draft', id });
              setView('write');
            }}
            onEtched={() => finish('timeline')}
            onChanged={refresh}
          />
        )}
        {view === 'backup' && (
          <Backup posts={posts} drafts={drafts} onImported={refresh} />
        )}
      </main>
    </div>
  );
}
