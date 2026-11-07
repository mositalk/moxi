import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { gradeQuiz, judge, wrongsToMarkdown } from '../js/grade.js';
import { inline } from '../js/markdown.js';
import { parseDocument } from '../js/parser.js';
import { localReply } from '../js/tutor.js';

const readSample = (name) => fs.readFileSync(new URL(`../samples/${name}`, import.meta.url), 'utf8');

test('Codex 第1章測驗卷：選擇、是非與橫向答案表', () => {
  const doc = parseDocument(readSample('codex-ch1-quiz.md'));
  assert.equal(doc.questions.length, 29);
  const first = doc.questions[0];
  assert.equal(first.type, 'mcq');
  assert.equal(first.answer, 'B');
  assert.equal(first.options.length, 4);
  assert.match(first.explanation, /程式代理/);
  const tf = doc.questions.find((item) => item.number === '16');
  assert.equal(tf.type, 'mcq');
  assert.equal(tf.answer, 'X');
  assert.deepEqual(tf.options.map((item) => item.key), ['O', 'X']);
  assert.equal(judge(tf, 'X').status, 'correct');
  assert.equal(judge(tf, 'O').status, 'wrong');
  assert.equal(doc.questions.find((item) => item.number === '25').answer, 'O');
  assert.equal(doc.questions.find((item) => item.number === '26').type, 'short');
  const lesson = parseDocument(readSample('codex-ch1.md'));
  assert.equal(lesson.title.includes('認識 Codex'), true);
  const lessonNotes = lesson.blocks.filter((block) => block.kind === 'note').map((block) => block.raw).join('\n');
  assert.match(lessonNotes, /本章學習目標/);
  assert.equal(lessonNotes.includes('1. 能夠用自己的話說明 Codex'), true);
});

test('投影片範例只認出兩題，編號清單仍是筆記', () => {
  const doc = parseDocument(readSample('slide.md'));
  assert.deepEqual(doc.questions.map((item) => item.number), ['1', '11']);
  const first = doc.questions[0];
  assert.equal(first.type, 'mcq');
  assert.equal(first.answer, 'A');
  assert.equal(first.options[0].text, 'nervous');
  assert.equal(doc.questions[1].type, 'cloze');
  assert.equal(doc.questions[1].answer, '玉山');
  const notes = doc.blocks.filter((block) => block.kind === 'note').map((block) => block.raw).join('\n');
  assert.equal(notes.includes('答案：'), false);
  assert.equal(notes.includes('先讀故事，再做題'), true);
});

test('同一行的選項、摺疊解答與譯文', () => {
  const doc = parseDocument(`# 測驗

1. Lily felt so ___ . (A) nervous (B) proud
答案：A

<details>
<summary>課文翻譯</summary>

這是翻譯，不是答案。
</details>

2. 這題答案在摺疊裡 ____。

<details>
<summary>解答</summary>

2. 玉山
</details>
`);
  assert.equal(doc.questions[0].type, 'mcq');
  assert.equal(doc.questions[0].options.length, 2);
  assert.equal(doc.questions[0].stem.includes('(A)'), false);
  assert.equal(doc.questions[1].answer, '玉山');
  const notes = doc.blocks.filter((block) => block.kind === 'note').map((block) => block.raw).join('\n');
  assert.match(notes, /這是翻譯/);
  assert.equal(notes.includes('玉山'), false);
});

test('程式碼區塊與解答表', () => {
  const doc = parseDocument(`# 表

\`\`\`
1. not a question ____
\`\`\`

1. 2 + 2 = ____。

## 解答

| 題號 | 答案 | 解析 |
| --- | --- | --- |
| 1 | 4 | 兩兩相加 |
`);
  assert.equal(doc.questions.length, 1);
  assert.equal(doc.questions[0].answer, '4');
  assert.equal(doc.questions[0].explanation, '兩兩相加');
  const notes = doc.blocks.filter((block) => block.kind === 'note').map((block) => block.raw).join('\n');
  assert.match(notes, /not a question/);
});

test('多空格、關鍵詞與批改', () => {
  const doc = parseDocument(`# 批改

1. ____ 高於 ____。
答案：玉山、雪山

2. 約 ____ 分鐘。
答案：20
關鍵詞：20
`);
  const [first, second] = doc.questions;
  assert.equal(first.blanks, 2);
  assert.equal(judge(first, ['玉山', '雪山']).status, 'correct');
  assert.equal(judge(first, ['雪山', '玉山']).status, 'wrong');
  assert.equal(judge(second, '20分鐘').status, 'correct');
  assert.equal(judge(second, '十分鐘').status, 'wrong');
});

test('選擇題大小寫、選項文字與未作答', () => {
  const feelings = parseDocument(readSample('feelings.md'));
  assert.equal(feelings.questions.length, 6);
  const first = feelings.questions[0];
  assert.equal(judge(first, 'b').status, 'correct');
  assert.equal(judge(first, 'A').status, 'wrong');
  assert.equal(judge(first, '').status, 'wrong');
  const cloze = feelings.questions[4];
  assert.equal(judge(cloze, '放心').status, 'correct');
  const graded = gradeQuiz(feelings.questions, { [first.id]: 'B', [cloze.id]: 'sad' });
  assert.equal(graded.correct >= 1, true);
});

test('錯題可以再匯出成 Markdown', () => {
  const doc = parseDocument(readSample('slide.md'));
  const graded = gradeQuiz(doc.questions, { q1: 'B', q2: '雪山' });
  const wrongs = graded.items.filter((item) => item.status === 'wrong').map((item) => ({
    ...item,
    docTitle: doc.title,
  }));
  const exported = wrongsToMarkdown(wrongs);
  const again = parseDocument(exported);
  assert.equal(again.questions.length, wrongs.length);
  assert.equal(again.questions[0].answer, 'A');
});

test('家教只根據這份筆記解釋', () => {
  const parsed = parseDocument(readSample('feelings.md'));
  const reply = localReply({ parsed, message: '為什麼第 1 題會錯？先不要公布答案' });
  assert.match(reply.text, /手心冒汗|nervous|上台/);
  assert.equal(/選 B/.test(reply.text), false);
  const summary = localReply({ parsed, message: '整理這份教材的重點' });
  assert.match(summary.text, /先看這個故事/);
});

test('筆記渲染會跳脫 HTML，並把空格畫出來', () => {
  assert.match(inline('<script>alert(1)</script>'), /&lt;script&gt;/);
  assert.match(inline('山是 ____。'), /class="gap"/);
  assert.match(inline('**玉山**'), /<strong>玉山<\/strong>/);
});
