// 把插件名稱加進 Pear Desktop 的語系檔（重複執行不會重複加入）
import fs from 'node:fs';
import path from 'node:path';

const repo = process.argv[2];
const entries = {
  'en.json': {
    description:
      'Shows which of your playlists a song is in and lets you remove it from search results',
    menu: {
      'full-refresh': 'Re-read all playlists',
      'refresh': 'Update changed playlists',
    },
    name: 'Playlist Manager',
  },
  'zh-TW.json': {
    description: '在搜尋結果標示歌曲在哪些歌單裡，並可直接從歌單移除',
    menu: {
      'full-refresh': '全部重新讀取',
      'refresh': '更新有變動的歌單',
    },
    name: '歌單管理',
  },
};

for (const [file, entry] of Object.entries(entries)) {
  const p = path.join(repo, 'src/i18n/resources', file);
  const raw = fs.readFileSync(p, 'utf8');
  const json = JSON.parse(raw);
  json.plugins['playlist-manager'] = entry;
  fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n');
}
console.log('語系檔已更新');
