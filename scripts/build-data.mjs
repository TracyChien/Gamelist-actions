// 在 GitHub Actions 的伺服器上執行，不受瀏覽器 CORS / 使用者網路限制影響。
// 需要環境變數 RAWG_TOKEN（RAWG API Key，從 https://rawg.io/apidocs 申請）。

import fs from 'node:fs/promises';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RAWG_KEY = process.env.RAWG_TOKEN;
if (!RAWG_KEY) {
  console.warn('未設定 RAWG_TOKEN 環境變數 —— RAWG API 每個請求都需要帶 key，沒有的話全部會失敗。');
}

// ---------------------------------------------------------------
// 簡易但穩健的 CSV 解析（支援雙引號、逗號、換行）
// ---------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
}

function checkImgur(url) {
  return url && /^https?:\/\/.+/i.test(url) ? url : '';
}
function splitMulti(str) {
  if (!str) return [];
  return str.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean);
}

// ---------------------------------------------------------------
// 1. 讀取設定 + 抓 Google Sheet CSV
// ---------------------------------------------------------------
const config = JSON.parse(await fs.readFile(new URL('../config.json', import.meta.url), 'utf-8'));
if (!config.csvUrl) throw new Error('config.json 缺少 csvUrl');

console.log('讀取 Google Sheet CSV:', config.csvUrl);
const csvRes = await fetch(config.csvUrl);
if (!csvRes.ok) throw new Error('CSV 下載失敗: HTTP ' + csvRes.status);
const csvText = await csvRes.text();
const rows = parseCsv(csvText);
if (!rows.length) throw new Error('CSV 內容是空的');

const headers = rows[0].map((h) => (h || '').trim().toUpperCase());
const records = [];
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  if (!r.some((c) => c && c.trim())) continue;
  const rec = {};
  headers.forEach((h, idx) => { rec[h] = (r[idx] || '').trim(); });
  if (!rec.TITLE) continue;
  records.push(rec);
}
console.log(`解析到 ${records.length} 筆遊戲資料`);

// ---------------------------------------------------------------
// 2. 向 RAWG API 查詢（有 RAWG_ID 就直接查，否則用 TITLE 搜尋取第一筆）
// ---------------------------------------------------------------
async function rawgFetch(path) {
  const url = `https://api.rawg.io/api/${path}${path.includes('?') ? '&' : '?'}key=${RAWG_KEY}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      console.warn('RAWG 429 rate limit，稍後重試...');
      await sleep(4000);
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      console.warn(`RAWG HTTP ${res.status}: ${text.slice(0, 200)}`);
      return null;
    }
    return res.json();
  }
  return null;
}

async function resolveRawgId(rec) {
  if (rec.RAWG_ID) return rec.RAWG_ID;
  const search = await rawgFetch(`games?search=${encodeURIComponent(rec.TITLE)}&page_size=1`);
  const first = search?.results?.[0];
  return first ? String(first.id) : null;
}

const rawgCache = {}; // id -> detail
const rawgIdByRecordIndex = [];

for (let i = 0; i < records.length; i++) {
  const rec = records[i];
  console.log(`解析 RAWG ID (${i + 1}/${records.length}): ${rec.TITLE}`);
  const id = await resolveRawgId(rec);
  rawgIdByRecordIndex.push(id);
  if (id && !rawgCache[id]) {
    const detail = await rawgFetch(`games/${id}`);
    if (detail) {
      rawgCache[id] = {
        name: detail.name || '',
        slug: detail.slug || '',
        image: detail.background_image || '',
        genres: (detail.genres || []).map((g) => g.name),
        developers: (detail.developers || []).map((d) => d.name),
        publishers: (detail.publishers || []).map((p) => p.name),
        released: detail.released || '',
      };
    } else {
      console.warn(`查無 RAWG 詳細資料: id=${id} (${rec.TITLE})`);
    }
  }
  await sleep(250); // 稍微放慢節奏，避免瞬間打太多請求
}

// ---------------------------------------------------------------
// 3. 合併 Sheet 手動欄位 + RAWG 自動資料
// ---------------------------------------------------------------
function buildGame(rec, idx) {
  const rawgId = rawgIdByRecordIndex[idx];
  const rawg = rawgId ? rawgCache[rawgId] : null;
  const platforms = splitMulti(rec.PLATFORM);
  const genre = rec.GENRE || (rawg && rawg.genres.length ? rawg.genres.join('、') : '');
  const publisher = rec.PUBLISHER || (rawg && (rawg.publishers[0] || rawg.developers[0])) || '';
  const image = checkImgur(rec.IMGUR) || (rawg ? rawg.image : '');
  const title = rec.TITLE || (rawg ? rawg.name : '');

  return {
    title,
    platforms,
    format: rec.FORMAT || '',
    genre,
    publisher,
    image,
    note: rec.NOTE || '',
    rawgId: rawgId || '',
    rawgSlug: rawg ? rawg.slug : '',
    released: rawg ? rawg.released : '',
  };
}

const games = records.map(buildGame);
const missing = records.map((r, i) => (!rawgIdByRecordIndex[i] ? r.TITLE : null)).filter(Boolean);

const output = {
  updatedAt: new Date().toISOString(),
  count: games.length,
  missingTitles: missing,
  games,
};

await fs.mkdir(new URL('../data/', import.meta.url), { recursive: true });
await fs.writeFile(new URL('../data/games.json', import.meta.url), JSON.stringify(output, null, 2), 'utf-8');
console.log(`完成，共 ${games.length} 款遊戲寫入 data/games.json${missing.length ? `（${missing.length} 款查無 RAWG 資料: ${missing.join(', ')}）` : ''}`);
