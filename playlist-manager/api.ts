/**
 * 與 YouTube Music 內部 API（InnerTube）溝通。
 * 修改的是雲端歌單本身，所以手機、YouTube 會自動同步。
 */
import {
  extractToken,
  getAuthorizationHeader,
  getClient,
} from '@/plugins/music-together/queue/client';

const ORIGIN = 'https://music.youtube.com';

/** 原始 fetch：插件自己的請求不會被「偵測歌單變動」攔截到 */
export const rawFetch: typeof fetch = window.fetch.bind(window);

type YtCfg = { get?: (key: string) => unknown };

const ytcfg = (): YtCfg | undefined =>
  (window as unknown as { ytcfg?: YtCfg }).ytcfg;

const cfg = <T>(key: string): T | undefined => ytcfg()?.get?.(key) as T;

const getContext = () => {
  const ctx = cfg<Record<string, unknown>>('INNERTUBE_CONTEXT');
  if (ctx) return ctx;
  return { client: getClient(), user: {} };
};

export const post = async <T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> => {
  const token = extractToken();
  if (!token) throw new Error('找不到登入資訊，請確認已登入 YouTube Music');

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': await getAuthorizationHeader(token),
    'X-Origin': ORIGIN,
    'X-Goog-AuthUser': String(cfg<number | string>('SESSION_INDEX') ?? '0'),
  };
  const visitor = cfg<string>('VISITOR_DATA');
  if (visitor) headers['X-Goog-Visitor-Id'] = visitor;
  const pageId = cfg<string>('DELEGATED_SESSION_ID');
  if (pageId) headers['X-Goog-PageId'] = pageId;

  const key = cfg<string>('INNERTUBE_API_KEY');
  const url = `${ORIGIN}/youtubei/v1/${endpoint}?prettyPrint=false${
    key ? `&key=${key}` : ''
  }`;

  const res = await rawFetch(url, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ context: getContext(), ...body }),
  });
  if (!res.ok) throw new Error(`YouTube Music API 錯誤 (${res.status})`);
  return (await res.json()) as T;
};

/* ---------- 通用的 JSON 走訪工具（比寫死路徑更耐改版） ---------- */

type Json = Record<string, unknown>;

const walk = (node: unknown, visit: (obj: Json) => void) => {
  if (Array.isArray(node)) {
    for (const v of node) walk(v, visit);
  } else if (node && typeof node === 'object') {
    visit(node as Json);
    for (const v of Object.values(node as Json)) walk(v, visit);
  }
};

const textOf = (runs: unknown): string => {
  const r = runs as { runs?: { text: string }[]; simpleText?: string };
  if (!r) return '';
  if (r.simpleText) return r.simpleText;
  return (r.runs ?? []).map((x) => x.text).join('');
};

const lastThumb = (node: unknown): string | undefined => {
  let url: string | undefined;
  walk(node, (o) => {
    if (!url && Array.isArray(o.thumbnails) && o.thumbnails.length) {
      const list = o.thumbnails as { url: string }[];
      url = list[list.length - 1].url;
    }
  });
  return url;
};

const findContinuation = (data: unknown): string | undefined => {
  let token: string | undefined;
  walk(data, (o) => {
    if (token) return;
    const cmd = o.continuationCommand as { token?: string } | undefined;
    if (cmd?.token) token = cmd.token;
    const next = o.nextContinuationData as
      | { continuation?: string }
      | undefined;
    if (next?.continuation) token = next.continuation;
  });
  return token;
};

/* ---------- 型別 ---------- */

export interface PlaylistMeta {
  id: string; // 不含 VL 前綴
  title: string;
  thumbnail?: string;
}

export interface PlaylistEntry {
  videoId: string;
  setVideoId: string;
  title: string;
  artists: string;
}

/* ---------- 讀取歌單清單 ---------- */

const SKIP_IDS = new Set(['LM', 'SE', 'LL']); // 喜歡的音樂、稍後收聽等自動清單

export interface LibraryPlaylist extends PlaylistMeta {
  /** 歌單清單頁上顯示的歌曲數；抓不到時為 undefined */
  reportedCount?: number;
}

/** 從「播放清單 • 某人 • 38 首歌曲」之類的副標抓出歌曲數 */
const parseCount = (subtitle: string): number | undefined => {
  const m = subtitle.match(/(\d[\d,.]*)\s*(?:首|songs?|tracks?|曲)/i);
  if (!m) return undefined;
  const n = Number(m[1].replace(/[,.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

export const listLibraryPlaylists = async (): Promise<LibraryPlaylist[]> => {
  const result = new Map<string, LibraryPlaylist>();
  const collect = (data: unknown) => {
    walk(data, (o) => {
      const item = (o.musicTwoRowItemRenderer ??
        o.musicResponsiveListItemRenderer) as Json | undefined;
      if (!item) return;
      let id: string | undefined;
      walk(item.navigationEndpoint ?? item, (n) => {
        const be = n.browseEndpoint as { browseId?: string } | undefined;
        if (!id && be?.browseId?.startsWith('VL')) id = be.browseId.slice(2);
      });
      if (!id || SKIP_IDS.has(id) || result.has(id)) return;
      const title =
        textOf(item.title) ||
        textOf(
          (
            (item.flexColumns as Json[] | undefined)?.[0]
              ?.musicResponsiveListItemFlexColumnRenderer as Json | undefined
          )?.text,
        );
      const cols = (item.flexColumns as Json[] | undefined) ?? [];
      const subtitle =
        textOf(item.subtitle) ||
        cols
          .slice(1)
          .map((c) =>
            textOf(
              (c.musicResponsiveListItemFlexColumnRenderer as Json | undefined)
                ?.text,
            ),
          )
          .join(' • ');
      result.set(id, {
        id,
        title,
        thumbnail: lastThumb(item.thumbnailRenderer),
        reportedCount: parseCount(subtitle),
      });
    });
  };

  let data = await post('browse', { browseId: 'FEmusic_liked_playlists' });
  collect(data);
  for (let i = 0, token = findContinuation(data); token && i < 20; i++) {
    data = await post('browse', { continuation: token });
    collect(data);
    token = findContinuation(data);
  }
  return [...result.values()];
};

/* ---------- 讀取單一歌單的歌曲 ---------- */

export const getPlaylistEntries = async (
  playlistId: string,
): Promise<{
  editable: boolean;
  entries: PlaylistEntry[];
  title?: string;
  thumbnail?: string;
}> => {
  const entries: PlaylistEntry[] = [];
  const seen = new Set<string>();
  let editable = false;
  let title: string | undefined;
  let thumbnail: string | undefined;

  const collect = (data: unknown) => {
    walk(data, (o) => {
      if (o.musicEditablePlaylistDetailHeaderRenderer) editable = true;
      const header = (o.musicResponsiveHeaderRenderer ??
        o.musicDetailHeaderRenderer) as Json | undefined;
      if (header && !title) {
        title = textOf(header.title) || undefined;
        thumbnail = lastThumb(header.thumbnail);
      }
      const item = o.musicResponsiveListItemRenderer as Json | undefined;
      if (!item) return;
      const pid = item.playlistItemData as
        | { videoId?: string; playlistSetVideoId?: string }
        | undefined;
      if (!pid?.videoId || !pid.playlistSetVideoId) return;
      if (seen.has(pid.playlistSetVideoId)) return;
      seen.add(pid.playlistSetVideoId);
      const cols = (item.flexColumns as Json[] | undefined) ?? [];
      const col = (i: number) =>
        textOf(
          (
            cols[i]?.musicResponsiveListItemFlexColumnRenderer as
              | Json
              | undefined
          )?.text,
        );
      entries.push({
        videoId: pid.videoId,
        setVideoId: pid.playlistSetVideoId,
        title: col(0),
        artists: col(1),
      });
    });
  };

  let data = await post('browse', { browseId: `VL${playlistId}` });
  collect(data);
  // 一千多首約需 10 幾頁；上限 200 頁以防無窮迴圈
  for (let i = 0, token = findContinuation(data); token && i < 200; i++) {
    data = await post('browse', { continuation: token });
    collect(data);
    token = findContinuation(data);
  }
  return { editable, entries, title, thumbnail };
};

/* ---------- 編輯歌單 ---------- */

export const removeFromPlaylist = async (
  playlistId: string,
  videoId: string,
  setVideoId: string,
) => {
  const res = await post<{ status?: string }>('browse/edit_playlist', {
    playlistId,
    actions: [
      { action: 'ACTION_REMOVE_VIDEO', removedVideoId: videoId, setVideoId },
    ],
  });
  if (res.status && res.status !== 'STATUS_SUCCEEDED') {
    throw new Error(`移除失敗（${res.status}）`);
  }
};

export const addToPlaylist = async (playlistId: string, videoId: string) => {
  const res = await post<Json>('browse/edit_playlist', {
    playlistId,
    actions: [{ action: 'ACTION_ADD_VIDEO', addedVideoId: videoId }],
  });
  // 回傳新的 setVideoId，讓索引保持正確
  let setVideoId: string | undefined;
  walk(res, (o) => {
    if (!setVideoId && typeof o.setVideoId === 'string') {
      setVideoId = o.setVideoId;
    }
  });
  return setVideoId;
};
