/**
 * 檢查 Pear Desktop 官方是否有新的正式版。
 * 有的話提醒用 install.sh 更新——直接裝官方版會讓這個插件消失。
 */
import { toast } from './ui';

const RELEASE_API =
  'https://api.github.com/repos/pear-devs/pear-desktop/releases/latest';
const CHECK_KEY = 'playlist-manager:update-check';
const DAY_MS = 24 * 60 * 60 * 1000;

interface CheckState {
  checkedAt: number;
  dismissed?: string; // 已經按過「知道了」的版本
}

const readState = (): CheckState => {
  try {
    return JSON.parse(localStorage.getItem(CHECK_KEY) ?? '') as CheckState;
  } catch {
    return { checkedAt: 0 };
  }
};

const writeState = (state: CheckState) => {
  try {
    localStorage.setItem(CHECK_KEY, JSON.stringify(state));
  } catch {
    // 忽略
  }
};

/** 比較 "3.12.0" 與 "3.13.1"；a 比 b 新回傳正數 */
export const compareVersions = (a: string, b: string) => {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
};

/** 一天最多檢查一次；同一個新版本按過「知道了」就不再提醒 */
export const checkForUpdate = async (currentVersion: string) => {
  const state = readState();
  if (Date.now() - state.checkedAt < DAY_MS) return;
  writeState({ ...state, checkedAt: Date.now() });

  const res = await fetch(RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) return;
  const { tag_name: tag } = (await res.json()) as { tag_name?: string };
  if (!tag || compareVersions(tag, currentVersion) <= 0) return;
  if (state.dismissed === tag) return;

  toast(
    `Pear Desktop 有新版 ${tag}。請在終端機執行 install.sh 更新，直接安裝官方版會讓「歌單管理」消失。`,
    {
      label: '知道了',
      run: () => writeState({ checkedAt: Date.now(), dismissed: tag }),
    },
    30_000,
  );
};
