# 碰碰車大亂鬥（bumper-sumo）

2～6 台可愛動物碰碰車擠在越縮越小的圓形擂台上，用衝刺把別人撞出場外，最後留在場上的贏；出局的人變成幽靈，還能往場上丟道具攪局。完整規格見 [規劃書.md](規劃書.md)。

## 怎麼開

```bash
npm install
npm start            # http://localhost:3250（Windows 也可以直接雙擊「啟動遊戲.bat」）
```

首頁、單機、自由練習、紀錄、怎麼玩都不連後端；只有按「跟別人玩」或打開邀請連結才載入 Socket.IO 並連線，離開線上模式就斷線。

## 模式

- **跟電腦玩**：1～5 台電腦，各自選幼幼／簡單／普通／困難／神話；本局難度（決定你的邊緣搶救時間與擂台最後大小）；個人混戰、2 對 2、3 對 3；10 套擂台主題或種子隨機組合；道具開關。
- **自由練習**：不計時、不縮圈，木頭靶車可增減、道具自選、掉下去自動回中間。
- **跟別人玩**：線上大廳（在線人數、房間列表、快速加入、私人房、大廳聊天室）、房間（席位、電腦簡單～神話、準備、房主開始／踢人、邀請連結可重發、觀戰 20 人、房間聊天）。

## 指令

| 指令 | 內容 |
|---|---|
| `npm test` | 規則單元測試、多語系完整性、SEO／GA4 |
| `npm run test:ai` | 五段電腦同場混戰 200 局，勝率需「神話 > 困難 > 普通 > 簡單 > 幼幼」 |
| `npm run test:online` | 開一台伺服器、多個客戶端實測線上流程（含 100／200ms 延遲） |
| `npm run test:browser` | 無頭瀏覽器操作檢查（需本機 Chrome／Edge 與 `npm start`） |
| `npm run shots` | 各畫面 × 手機／平板直橫／桌機截圖到 `shots/`（不進 git） |
| `npm run gen:hans` | 用 OpenCC（opencc-js，台灣繁體→簡體＋慣用詞）從繁中產生簡中 `public/js/locales-hans.js` |
| `npm run inject` | 把 `GAME_SERVER_URL` 注入 `public/js/config.js`（前端另外部署時） |
| `node scripts/make-art.js` | 用遊戲向量美術產生 SEO 圖、封面與網站圖示 |

## 架構

```
server.js            Express（靜態檔、/health）＋ Socket.IO
lib/rooms.js         房間、席位、觀戰、邀請、重連、零真人關房、伺服器權威對局迴圈（60Hz 物理、約 30 次／秒廣播）
lib/lobby-chat.js    大廳聊天室（各遊戲共用）
public/js/rules.js   規則與物理核心（瀏覽器與伺服器同一份；固定步長、種子亂數、可重現）
public/js/ai.js      五段電腦（只讀公開資訊、不作弊）
public/js/app.js     畫面流程；render.js（Canvas）、art.js（車子／駕駛／主題）、input.js、audio.js、ui.js（自繪元件）
public/js/net.js     線上連線（心跳、重連、延遲量測）；records.js（紀錄與成就）；share.js（結算圖片分享）
public/js/config.js  server URL 唯一入口
```

線上：伺服器說了算（碰撞、出界、撞飛數都由伺服器判定），客戶端只送方向／衝刺／道具；自己的車先在本機預測、收到伺服器狀態再平滑校正；衝刺 0.15 秒蓄力蓋掉延遲、衝刺碰撞範圍放大 15%。

## 環境變數

見 [.env.example](.env.example)：`PORT`、`HOST`、`GAME_ALLOWED_ORIGIN`、`COUNTDOWN_MS`、`RECONNECT_MS`、`GAME_SERVER_URL`（前端）。

## 部署（已準備、尚未部署）

- 後端：Render（`render.yaml`，region singapore，`/health` 只給平台健康檢查）。
- 前端：GitHub Pages（`.github/workflows/deploy-pages.yml`）。在 repo 設 Actions variable `GAME_SERVER_URL` = Render 的 HTTPS 網址；Render 的 `GAME_ALLOWED_ORIGIN` 設成 Pages 的來源。
- 依規劃書：只做本機 commit，不 push、不建立雲端服務。

## 紀錄與成就

- 只存在這個瀏覽器（localStorage `bumper-sumo:v1:records`，schemaVersion 1），近期明細保留 100 局；以 matchId 去重（另存已記錄的 matchId，不只看近期明細）。
- 計入：單機（本機規則確認的結果，依本局難度分開統計）、線上（伺服器 `game:over` 的結果）。不計入：自由練習、觀戰、中途離開。
- 統計：完成局數、第一名、累計撞飛、個人最佳（單局最多撞飛、最長存活、單局最多搶救）。
- 成就：第一次上場（1 局）、最後的贏家（第一次拿第一）、碰碰車常客（20 局）、三連撞（單局撞飛 3）、撞飛大王（累計撞飛 50）、邊緣求生（單局搶救 3 次）、不沾鍋（3 台以上的局拿第一且沒被撞）、屠龍勇士（有神話電腦的局拿第一）、熱心幽靈（單局幽靈丟 3 個道具）、道具收藏家（6 種道具都用過）、線上冠軍（線上拿第一）。
- 設定視窗有「清除紀錄與成就」（確認後才清；「恢復預設」不會清紀錄）。

## 決定與假設

- 斷線寬限採規劃書 Q23 的 10 秒（skill 預設 30 秒）；對局中逾時當作出局變幽靈，不交給電腦。
- 一局最長 93 秒（含倒數），skill 的「3 分鐘閒置棄權」在本遊戲不會發生，因此不另做。
- 新手教學：規劃書指定靜態圖文「怎麼玩」，加上可實際操作的「自由練習」，不另做關卡式教學。
- 宣傳圖與圖示由遊戲自己的向量美術產生（此環境沒有圖像生成工具）；需要黏土風正式宣傳圖時可再替換 `public/assets/images/`。
- 音樂與音效全部用 Web Audio 即時合成，沒有外部音檔授權問題；要換正式音檔可替換 `public/js/audio.js`。
