# 墨習 Moxi

一份 Markdown，就是一整套學習工具。

這是 HackDay「打造個人化學習」的作品：同一份 `.md` 同時是筆記、考卷、解答和家教教材。寫法被認成題目之後，可以作答、自動批改、畫記、把錯題收回來，再問家教為什麼。

靈感來自「一份檔案展開成多種學習用法」的架構。墨習不是 [eZstudy](https://apps.ezetas.com/ezstudy.html)，也與 eZETAs 無隸屬。

## 怎麼打開

在這個資料夾執行：

```bash
py server.py
```

若已安裝 Node.js 18 以上，也可以：

```bash
node server.mjs
```

再開啟終端機印出的網址，例如 `http://127.0.0.1:5173`。不要直接雙擊 `index.html`，瀏覽器會擋住教材檔。

編寫教材用的是 EURD 既有的 Markdown 工具（`vendor/urd-markdown.js`，來自 `FUNC/js/urd-markdown.js`），工具列、插入與預覽都沒有另外重寫。按下儲存後，同一份內容會變成墨習的筆記、考卷、錯題本和家教教材。這支檔案的授權以 EURD 為準，墨習的 MIT 授權不含它。

檢查題目解析：

```bash
node --test
```

## 一份檔案怎麼被用

| 用法 | 做什麼 |
| --- | --- |
| 筆記講義 | 把 Markdown 排成講義，題目會被標出來，答案先藏住 |
| 螢光筆筆記 | 選取句子上色，畫記留在這台瀏覽器 |
| 直接作答 | 選擇、填空、簡答 |
| 自動批改 | 對答案、顯示解析 |
| 錯題本 | 留下答錯的題，可重練，也可再匯出成 `.md` |
| AI 家教 | 只用這份教材回答。沒有 API 金鑰時，引用筆記裡的句子 |

個人化發生在這台瀏覽器裡：今天做了幾題、哪一段錯最多、下一步要重讀還是只練錯題。名稱、作答、畫記和 API 金鑰都放在 `localStorage`，不會寫回教材檔。

## 題目怎麼寫

編號列有空格、選項、`答案：` 或問號，就會變成題目。普通的編號清單仍是筆記。

```markdown
## 英文一例

Lily 上台前手心冒汗，得獎之後才笑。

1. Lily felt so ___ before the speech.
(A) nervous (B) proud
答案：A
解析：before the speech 是上台之前。

11. 台灣最高的山是 ____。
答案：玉山
解析：玉山主峰 3952 公尺。
```

也可以把答案集中在最後：

```markdown
## 解答

1. A
11. 玉山
```

`<details><summary>解答</summary>` 裡的題號也認。多個可接受答案用 `/`，例如 `relieved/放心`。超過一個空格時，答案用 `、` 分開。`關鍵詞：同一段` 代表回答裡含有這些詞就算對。

## 選用模型

設定裡可以填 OpenAI 相容的 API 位址、模型名稱和金鑰。金鑰只留在這台瀏覽器，送出時只打到你填的位址。沒填也能示範，家教會改引用這份 Markdown。

## 開源

本專案以 MIT 授權釋出。若要放到 GitHub：

```bash
git init
git add .
git commit -m "建立墨習：一份 Markdown 同時成為筆記、考卷與家教。"
gh repo create moxi --public --source=. --remote=origin --push
```

內建教材在 `samples/`，都是自撰短文，不是教科書課文。
