# 電子遊戲櫃

跟桌遊櫃同一套架構：Google Sheet 只填基本資料，GitHub Actions 定期在自己的伺服器上抓 [RAWG](https://rawg.io) 的封面/類型/發行商資料，整理成 `data/games.json`，網頁只讀這個同源檔案，完全不對外連線。

## 檔案結構

```
index.html                        ← 網頁本體
config.json                       ← 填你的 Google Sheet CSV 網址
package.json
scripts/build-data.mjs            ← 抓資料、整理成 json 的腳本
data/games.json                   ← 產生出來的資料（一開始是空的佔位檔）
.github/workflows/update-data.yml ← 定期執行腳本的設定
```

## 設定步驟

1. **申請 RAWG API Key**：到 https://rawg.io/login/?forward=developer 登入/註冊帳號，選 Free 方案，當場產生 API Key（即時核發，不用審核）。
2. **改 `config.json`**：把 `csvUrl` 換成你 Google Sheet 發布成 CSV 的網址。
3. **設定 GitHub Secret**：repo 的 `Settings → Secrets and variables → Actions → New repository secret`，Name 填 `RAWG_TOKEN`，Secret 填剛剛申請的 key。
4. **開權限**：`Settings → Actions → General → Workflow permissions`，選「Read and write permissions」。
5. **開 GitHub Pages**：`Settings → Pages`，Source 選 `Deploy from a branch`，Branch 選 `main`、資料夾選 `/ (root)`。
6. **手動跑第一次**：`Actions` 分頁 → `Update game data` → `Run workflow`。

## Google Sheet 欄位

第一列是欄位名稱，除了 `TITLE`，其餘都可留空：

| 欄位 | 說明 |
|---|---|
| `TITLE` | 遊戲名稱（必填），也會拿去向 RAWG 搜尋比對。 |
| `PLATFORM` | 你擁有的平台，填 `Switch`、`PS5`，兩者都有就填 `Switch、PS5`。 |
| `FORMAT` | `實體` 或 `數位`。 |
| `RAWG_ID` | 選填。RAWG 遊戲 ID 或 slug，用來避免搜尋比對錯遊戲（例如重製版跟原版搞混時）。要找 ID，可以到 rawg.io 上搜尋該遊戲，網址裡的數字或最後那段文字就是。 |
| `GENRE` / `PUBLISHER` | 選填，手動填會覆蓋自動帶出的資料。 |
| `IMGUR` | 選填，自訂封面圖網址，優先於自動抓到的圖。 |
| `NOTE` | 選填，自訂備註。 |

## 疑難排解

- **RAWG_TOKEN 沒設定**：build log 會警告，且幾乎所有遊戲都會抓不到資料。
- **RAWG 免費方案限制**：每月 2 萬次請求（一般個人用量遠遠用不完），且條款要求標註出處＋在網頁上放一個連回 RAWG 的超連結（已經放在頁尾，不要刪掉）。
- **搜尋比對到錯的遊戲**：填 `RAWG_ID` 欄位手動指定正確的那一筆。
