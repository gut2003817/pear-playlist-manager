/**
 * 歌單索引：videoId → 所在歌單。
 * 存在 localStorage，開啟 App 時於背景更新。
 */
import {
  addToPlaylist,
  getPlaylistEntries,
  listLibraryPlaylists,
  removeFromPlaylist,
  type PlaylistEntry,
  type PlaylistMeta,
} from './api';

export interface IndexedPlaylist extends PlaylistMeta {
  count: number;
}

export interface Membership {
  playlist: IndexedPlaylist;
  entry: PlaylistEntry;
}

interface Snapshot {
  version: 1;
  updatedAt: number;
  playlists: IndexedPlaylist[];
  entries: Record<string, PlaylistEntry[]>; // playlistId → entries
  /** 別人的歌單（不能編輯），快速更新時直接跳過 */
  ignored?: string[];
}

export type RefreshMode = 'quick' | 'full';

export interface RefreshResult {
  total: number; // 歌單總數
  read: number; // 實際重讀的歌單數
}

const STORAGE_KEY = 'playlist-manager:index:v1';
const STALE_MS = 6 * 60 * 60 * 1000; // 6 小時

let snapshot: Snapshot | null = null;
let byVideo = new Map<string, Membership[]>();
let byName = new Map<string, Membership[]>();
let refreshing: Promise<RefreshResult> | null = null;
const listeners = new Set<() => void>();

/** 正規化標題／歌手，用於「可能是不同版本」的模糊比對 */
export const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|（.*?）|\[.*?]|【.*?】/g, ' ')
    .replace(
      /official|music video|lyrics?|lyric video|audio|mv|動態歌詞|歌詞版?|完整版|官方|高音質/g,
      ' ',
    )
    .replace(/[\s\-_|・·,.、:：'"!?！？&]+/g, '')
    .trim();

const nameKeys = (title: string, artists: string) => {
  const t = normalize(title);
  const firstArtist = normalize(artists.split(/[,&、•·]/)[0] ?? '');
  const keys = new Set<string>();
  if (t) keys.add(`${t}|${firstArtist}`);
  return keys;
};

/** 影片標題常是「歌手 - 歌名 Lyrics」，拆成歌名與歌手 */
export const splitVideoTitle = (title: string, artists: string) => {
  const m = title.match(/^(.+?)\s*[-–—|｜]\s*(.+)$/);
  if (m)
    return [
      { title: m[2], artists: m[1] },
      { title: m[1], artists: m[2] },
      { title, artists },
    ];
  return [{ title, artists }];
};

const rebuild = () => {
  byVideo = new Map();
  byName = new Map();
  if (!snapshot) return;
  for (const playlist of snapshot.playlists) {
    for (const entry of snapshot.entries[playlist.id] ?? []) {
      const m = { playlist, entry };
      const list = byVideo.get(entry.videoId) ?? [];
      list.push(m);
      byVideo.set(entry.videoId, list);
      for (const key of nameKeys(entry.title, entry.artists)) {
        const l = byName.get(key) ?? [];
        l.push(m);
        byName.set(key, l);
      }
    }
  }
  listeners.forEach((fn) => fn());
};

const save = () => {
  if (!snapshot) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // 空間不足時忽略，下次開啟會重新抓
  }
};

export const load = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Snapshot;
      if (parsed.version === 1) snapshot = parsed;
    }
  } catch {
    snapshot = null;
  }
  rebuild();
};

export const onChange = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const isReady = () => snapshot !== null;
export const isRefreshing = () => refreshing !== null;
export const isStale = () =>
  !snapshot || Date.now() - snapshot.updatedAt > STALE_MS;

/** 同時讀幾個歌單；太多可能被 YouTube 限流 */
const CONCURRENCY = 5;

const runPool = async <T>(items: T[], worker: (item: T) => Promise<void>) => {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(CONCURRENCY, items.length) },
    async () => {
      while (next < items.length) await worker(items[next++]);
    },
  );
  await Promise.all(lanes);
};

/**
 * quick：只重讀歌曲數有變、或新出現的歌單（手動更新與背景更新用）
 * full：全部重讀（第一次，或懷疑資料不對時）
 */
export const refresh = (
  mode: RefreshMode = 'quick',
  onProgress?: (done: number, total: number) => void,
): Promise<RefreshResult> => {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const metas = await listLibraryPlaylists();
      const old = snapshot;
      const quick = mode === 'quick' && old !== null;
      const oldById = new Map(old?.playlists.map((p) => [p.id, p]));
      const ignored = new Set(quick ? (old?.ignored ?? []) : []);

      const playlists = new Map<string, IndexedPlaylist>();
      const entries: Record<string, PlaylistEntry[]> = {};
      const toRead: typeof metas = [];

      for (const meta of metas) {
        if (ignored.has(meta.id)) continue;
        const cached = oldById.get(meta.id);
        const unchanged =
          quick &&
          cached &&
          meta.reportedCount !== undefined &&
          meta.reportedCount === cached.count;
        if (unchanged) {
          playlists.set(meta.id, {
            ...cached,
            title: meta.title || cached.title,
            thumbnail: meta.thumbnail ?? cached.thumbnail,
          });
          entries[meta.id] = old?.entries[meta.id] ?? [];
        } else {
          toRead.push(meta);
        }
      }

      const editable = new Map<string, boolean>();
      let done = 0;
      await runPool(toRead, async (meta) => {
        try {
          const res = await getPlaylistEntries(meta.id);
          playlists.set(meta.id, {
            id: meta.id,
            title: meta.title,
            thumbnail: meta.thumbnail,
            count: res.entries.length,
          });
          entries[meta.id] = res.entries;
          editable.set(meta.id, res.editable);
        } catch (err) {
          console.warn('[playlist-manager] 無法讀取歌單', meta.title, err);
          const cached = oldById.get(meta.id);
          if (cached && old) {
            playlists.set(meta.id, cached);
            entries[meta.id] = old.entries[meta.id] ?? [];
          }
        }
        onProgress?.(++done, toRead.length);
      });

      // 只保留自己建立（可編輯）的歌單；若偵測失效（讀到的全都不可編輯）就全部保留
      const detectWorks = [...editable.values()].some(Boolean) || quick;
      for (const [id, isEditable] of editable) {
        if (detectWorks && !isEditable) {
          playlists.delete(id);
          delete entries[id];
          ignored.add(id);
        }
      }

      // 依照歌單清單原本的順序；已刪除的歌單自然不會出現
      const ordered = metas
        .map((m) => playlists.get(m.id))
        .filter((p): p is IndexedPlaylist => p !== undefined);
      snapshot = {
        version: 1,
        updatedAt: Date.now(),
        playlists: ordered,
        entries: Object.fromEntries(ordered.map((p) => [p.id, entries[p.id]])),
        ignored: [...ignored].filter((id) => metas.some((m) => m.id === id)),
      };
      save();
      rebuild();
      return { total: metas.length, read: toRead.length };
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
};

const AUTO_PLAYLISTS = new Set(['LM', 'SE', 'LL']);

/** 只重新讀取單一歌單（加歌、新建歌單後使用，約 1 秒） */
export const refreshOne = async (playlistId: string, titleHint?: string) => {
  if (!snapshot || AUTO_PLAYLISTS.has(playlistId)) return;
  if (refreshing) await refreshing.catch(() => undefined);
  if (!snapshot) return;
  const res = await getPlaylistEntries(playlistId);
  const existing = snapshot.playlists.find((p) => p.id === playlistId);
  if (existing) {
    existing.count = res.entries.length;
    if (res.thumbnail) existing.thumbnail = res.thumbnail;
    if (res.title) existing.title = res.title;
  } else {
    snapshot.playlists.push({
      id: playlistId,
      title: res.title ?? titleHint ?? '新歌單',
      thumbnail: res.thumbnail,
      count: res.entries.length,
    });
  }
  snapshot.entries[playlistId] = res.entries;
  save();
  rebuild();
};

/** 歌單被刪除時從索引移除 */
export const dropPlaylist = (playlistId: string) => {
  if (!snapshot) return;
  snapshot.playlists = snapshot.playlists.filter((p) => p.id !== playlistId);
  delete snapshot.entries[playlistId];
  save();
  rebuild();
};

/** 依歌曲數由多到少排序；第一個就是「代表歌單」 */
const byCountDesc = (a: Membership, b: Membership) =>
  b.playlist.count - a.playlist.count;

export const exactMatches = (videoId: string): Membership[] =>
  [...(byVideo.get(videoId) ?? [])].sort(byCountDesc);

/** 名稱相同但 videoId 不同（例如歌詞影片 vs 官方歌曲） */
export const fuzzyMatches = (
  videoId: string,
  title: string,
  artists: string,
): Membership[] => {
  const found = new Map<string, Membership>();
  for (const c of splitVideoTitle(title, artists)) {
    for (const key of nameKeys(c.title, c.artists)) {
      for (const m of byName.get(key) ?? []) {
        if (m.entry.videoId !== videoId) found.set(m.entry.setVideoId, m);
      }
    }
  }
  return [...found.values()].sort(byCountDesc);
};

export const remove = async (m: Membership) => {
  await removeFromPlaylist(m.playlist.id, m.entry.videoId, m.entry.setVideoId);
  if (!snapshot) return;
  const list = snapshot.entries[m.playlist.id] ?? [];
  snapshot.entries[m.playlist.id] = list.filter(
    (e) => e.setVideoId !== m.entry.setVideoId,
  );
  m.playlist.count = snapshot.entries[m.playlist.id].length;
  save();
  rebuild();
};

/** 復原：重新加回歌單（會加在最後面） */
export const restore = async (m: Membership) => {
  const setVideoId = await addToPlaylist(m.playlist.id, m.entry.videoId);
  if (!snapshot) return;
  const entry = { ...m.entry, setVideoId: setVideoId ?? m.entry.setVideoId };
  (snapshot.entries[m.playlist.id] ??= []).push(entry);
  m.playlist.count = snapshot.entries[m.playlist.id].length;
  save();
  rebuild();
};
