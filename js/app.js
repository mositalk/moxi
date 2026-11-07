import { gradeQuiz, wrongsToMarkdown } from './grade.js';
import { esc, inline, renderNote } from './markdown.js';
import { parseDocument } from './parser.js';
import { emptyStore, loadStore, localDate, saveStore, streak, todayCount } from './store.js';
import { replyTo } from './tutor.js';

const BUILTINS = [
  { id: 'math2', file: 'samples/math-g1-ch2.md', chapter: 'math2', role: '教材', quizId: 'math2-quiz' },
  { id: 'math2-quiz', file: 'samples/math-g1-ch2-quiz.md', chapter: 'math2', role: '測驗卷', lessonId: 'math2' },
  { id: 'codex1', file: 'samples/codex-ch1.md', chapter: 'codex1', role: '教材', quizId: 'codex1-quiz' },
  { id: 'codex1-quiz', file: 'samples/codex-ch1-quiz.md', chapter: 'codex1', role: '測驗卷', lessonId: 'codex1' },
  { id: 'slide', file: 'samples/slide.md' },
  { id: 'feelings', file: 'samples/feelings.md' },
  { id: 'yushan', file: 'samples/yushan.md' },
  { id: 'rhythm', file: 'samples/rhythm.md' },
];

const TYPE_LABEL = { mcq: '選擇題', multi: '複選', cloze: '填空', short: '簡答' };
const CHAPTERS = [
  ['高一數學 第二章', 'math2'],
  ['Codex 第1章', 'codex1'],
];
const SATELLITES = [
  { mode: 'read', label: '筆記講義', angle: 0 },
  { mode: 'quiz', label: '直接作答', angle: 60 },
  { mode: 'grade', label: '自動批改', angle: 120 },
  { mode: 'wrong', label: '錯題本', angle: 180 },
  { mode: 'mark', label: '螢光筆筆記', angle: 240 },
  { mode: 'tutor', label: 'AI 家教', angle: 300 },
];

const state = {
  view: 'home',
  mode: 'read',
  activeId: 'slide',
  builtins: [],
  docs: [],
  data: emptyStore(),
  showSource: false,
  editingId: '',
  libQuery: '',
  libFilter: 'all',
  tagOpen: false,
  pen: '',
  pendingSelection: '',
  sending: false,
};

const ICONS = {
  read: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7.2L19 8v12.5H7z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 3.8V8h4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  quiz: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16.5 8.2 6h1.7l3.2 10.5M6.2 13h5.4M14.5 8.5h4.2M16.6 8.5v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  grade: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 9 16.5 19 7.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wrong: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  mark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 16.5 14.2 6.3a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L7.5 20H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  tutor: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16.5A6.5 6.5 0 1 1 12.2 18L7 20.2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};

function hash(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return (value >>> 0).toString(16);
}

function parsedOf(doc) {
  if (!doc) return { title: '未命名教材', blocks: [], questions: [] };
  if (doc.cacheSource !== doc.source) {
    doc.parsed = parseDocument(doc.source);
    doc.cacheSource = doc.source;
  }
  return doc.parsed;
}

function active() {
  const doc = state.docs.find((item) => item.id === state.activeId) || state.docs[0];
  return { doc, parsed: parsedOf(doc) };
}

function persist() {
  try {
    saveStore(state.data);
  } catch {
    toast('這台瀏覽器的儲存空間滿了，這次沒有存下來。');
  }
}

function syncDocs() {
  const review = state.docs.find((item) => item.id === 'review');
  state.docs = [...state.builtins, ...state.data.imports, ...(review ? [review] : [])];
}

function filled(value) {
  if (Array.isArray(value)) return value.some((item) => String(item || '').trim());
  return Boolean(String(value || '').trim());
}

function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    node.hidden = true;
  }, 2400);
}

function polar(angle, radius) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: 50 + radius * Math.cos(rad), y: 50 + radius * Math.sin(rad) };
}

function cleanup(raw) {
  return String(raw || '')
    .replace(/^#{1,6}\s+.*/gm, '')
    .replace(/[*_`>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function blurb(parsed, section) {
  const own = cleanup(parsed.blocks.filter((block) => block.kind === 'note' && block.section === section).map((block) => block.raw).join('\n'));
  let text = own;
  if (!text) {
    const index = parsed.blocks.findIndex((block) => block.kind === 'question' && block.section === section);
    const previous = [...parsed.blocks.slice(0, Math.max(index, 0))].reverse().find((block) => block.kind === 'note' && cleanup(block.raw));
    text = previous ? cleanup(previous.raw) : '';
  }
  if (!text) return '';
  return text.length > 96 ? `${text.slice(0, 96)}…` : text;
}

function stemHtml(question, interactive, value) {
  if (question.type === 'cloze' && interactive) {
    const bits = question.stem.split(/_{2,}|＿{2,}/);
    const values = Array.isArray(value) ? value : [];
    return bits.map((bit, index) => {
      const piece = inline(bit);
      if (index === bits.length - 1) return piece;
      return `${piece}<input class="gap-input" data-qid="${question.id}" data-blank="${index}" value="${esc(values[index] || '')}" aria-label="第 ${index + 1} 空">`;
    }).join('');
  }
  return inline(question.stem);
}

function optionsHtml(question, value, interactive) {
  if (question.options.length < 2) return '';
  const multi = question.type === 'multi';
  return `<div class="options">${question.options.map((option) => {
    const picked = multi ? Array.isArray(value) && value.includes(option.key) : value === option.key;
    if (!interactive) {
      return `<p class="opt is-static"><span class="key">${option.key}</span><span>${inline(option.text)}</span></p>`;
    }
    return `<label class="opt${picked ? ' is-picked' : ''}"><input type="${multi ? 'checkbox' : 'radio'}" name="q-${question.id}" data-qid="${question.id}" value="${option.key}"${picked ? ' checked' : ''}><span class="key">${option.key}</span><span>${inline(option.text)}</span></label>`;
  }).join('')}</div>`;
}

function weakest(items) {
  const map = new Map();
  for (const item of items || []) {
    if (item.status !== 'correct' && item.status !== 'wrong') continue;
    const key = item.section || '未分章';
    const group = map.get(key) || { wrong: 0, total: 0 };
    group.total += 1;
    if (item.status === 'wrong') group.wrong += 1;
    map.set(key, group);
  }
  return [...map.entries()].filter((entry) => entry[1].wrong > 0).sort((a, b) => b[1].wrong - a[1].wrong)[0] || null;
}

function openDoc(id, mode = state.mode) {
  if (!state.docs.some((item) => item.id === id)) return;
  state.activeId = id;
  state.mode = mode;
  state.view = 'study';
  state.tagOpen = false;
  render();
}

function render() {
  document.querySelector('#hl-pop').hidden = true;
  renderChrome();
  renderLibrary();
  renderView();
  renderSide();
  if ((state.mode === 'read' || state.mode === 'mark') && state.view === 'study') {
    const marks = state.data.marks[state.activeId] || [];
    document.querySelectorAll('.sheet .prose, .sheet .q').forEach((node) => applyMarks(node, marks));
  }
  document.querySelector('.chat-log')?.scrollTo(0, 1e9);
}

function renderChrome() {
  document.body.classList.toggle('is-home', state.view === 'home');
  document.body.classList.toggle('is-study', state.view === 'study');
  const title = document.querySelector('#doc-title');
  const sourceBtn = document.querySelector('#toggle-source');
  if (state.view === 'home') {
    title.textContent = 'HackDay · 打造個人化學習';
    document.title = '墨習 — 一份 Markdown，一整套學習工具';
    sourceBtn.hidden = true;
    document.querySelector('#edit-doc').hidden = true;
  } else {
    const { parsed } = active();
    title.textContent = parsed.title;
    document.title = `${parsed.title} — 墨習`;
    sourceBtn.hidden = false;
    sourceBtn.textContent = state.showSource ? '收回原文' : '看 Markdown';
    document.querySelector('#edit-doc').hidden = false;
  }
  document.querySelectorAll('.modes [data-mode]').forEach((button) => {
    const on = state.view === 'study' && button.dataset.mode === state.mode;
    button.classList.toggle('is-on', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function docTags(id) {
  return state.data.tags?.[id] || [];
}

function docMatches(doc, query) {
  if (!query) return true;
  const parsed = parsedOf(doc);
  const hay = `${parsed.title}\n${doc.filename || ''}\n${docTags(doc.id).join(' ')}\n${doc.source || ''}`.toLowerCase();
  return hay.includes(query);
}

function renderLibrary() {
  const list = document.querySelector('#library-list');
  if (!list) return;
  const query = state.libQuery.trim().toLowerCase();
  const mineAll = state.docs.filter((item) => !item.builtin && !item.virtual);
  const chapterIds = new Set(CHAPTERS.map(([, id]) => id));
  const chapterGroups = CHAPTERS.map(([label, id]) => [label, state.builtins.filter((doc) => doc.chapter === id && docMatches(doc, query)), 'demo']);
  const demo = state.builtins.filter((doc) => !chapterIds.has(doc.chapter) && docMatches(doc, query));
  const mine = mineAll.filter((doc) => docMatches(doc, query));
  const chapterCount = chapterGroups.reduce((sum, [, docs]) => sum + docs.length, 0);
  const counts = { all: chapterCount + demo.length + mine.length, demo: chapterCount + demo.length, mine: mine.length };
  document.querySelectorAll('[data-lib]').forEach((button) => {
    const key = button.dataset.lib;
    button.classList.toggle('is-on', key === state.libFilter);
    const label = key === 'demo' ? '示範' : key === 'mine' ? '我的' : '全部';
    button.textContent = `${label} ${counts[key]}`;
  });
  const groups = [
    ...chapterGroups,
    ['示範教材', demo, 'demo'],
    ['我的教材', mine, 'mine'],
  ].filter(([, docs, key]) => (state.libFilter === 'all' || state.libFilter === key) && (docs.length || key === 'mine'));
  const body = groups.map(([label, docs]) => {
    if (!docs.length) {
      if (query) return '';
      return `<p class="kicker folder"><span>${label}</span><span>0</span></p><p class="hint">開啟或新增一份 .md，它會同時變成筆記和考卷。</p>`;
    }
    return `<p class="kicker folder"><span>${label}</span><span>${docs.length}</span></p>${docs.map((doc) => {
      const parsed = parsedOf(doc);
      const tags = docTags(doc.id);
      const kind = doc.role || (parsed.questions.length ? `${parsed.questions.length} 題` : '講義');
      const extra = doc.role && parsed.questions.length ? `${parsed.questions.length} 題` : '';
      return `<div class="doc${doc.id === state.activeId && state.view === 'study' ? ' is-on' : ''}"><button type="button" data-open="${doc.id}"><span>${esc(parsed.title)}</span><small>${esc(kind)}${extra ? ` · ${extra}` : ''}${tags.length ? ` · ${esc(tags.join(' · '))}` : ''}</small></button>${doc.builtin ? '' : `<button type="button" class="icon-btn" data-del-doc="${doc.id}" aria-label="移除教材">×</button>`}</div>`;
    }).join('')}`;
  }).join('');
  const empty = query && !counts.all ? '<p class="hint">沒有符合的檔案。</p>' : '';
  list.innerHTML = `${body}${empty}<button type="button" class="solid" data-act="browse">開啟 .md</button>`;
}

function plainOutline(text) {
  return String(text)
    .replace(/\$\$?([^$]+)\$\$?/g, ' $1 ')
    .replace(/\\neq?\b/g, '≠')
    .replace(/\\le\b/g, '≤')
    .replace(/\\ge\b/g, '≥')
    .replace(/\\times\b/g, '×')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderSide() {
  const side = document.querySelector('#side');
  if (state.view !== 'study') {
    side.innerHTML = '';
    return;
  }
  const { doc, parsed } = active();
  if (!doc) return;
  const name = state.data.profile.name;
  const who = name || '你';
  const submission = state.data.submissions[doc.id];
  const today = todayCount(state.data.gradedLog);
  const days = streak(state.data.gradedLog);
  const goal = state.data.profile.goal || 10;
  const weak = weakest(submission?.items);
  const docWrongs = state.data.wrongs.filter((item) => item.docId === doc.id);
  let coach = doc.quizId
    ? `${who}先讀這份教材，再做同一章的測驗卷。`
    : doc.lessonId
      ? `${who}這份是測驗卷。不確定時先回教材看同一小節。`
      : `${who}可以先讀筆記，再做同一份檔案裡的題。`;
  if (submission && submission.graded) {
    const pct = Math.round((submission.correct / submission.graded) * 100);
    coach = pct === 100
      ? `${who}這份目前全對。下一步可以請家教把重點改成口試。`
      : `${who}這份答對 ${pct}%。${weak ? `「${weak[0]}」錯了 ${weak[1].wrong} 題。` : ''}先回到那段筆記，再練錯題。`;
  }
  const outline = [];
  for (const block of parsed.blocks) {
    if (block.kind !== 'note') continue;
    const heading = block.raw.match(/^#{2,3}\s+(.+)$/m);
    if (heading) outline.push(heading[1].replace(/[*_`~]/g, '').trim());
  }
  const marks = state.data.marks[doc.id] || [];
  side.innerHTML = `
    <p class="kicker">這份檔案同時是</p>
    <p>筆記 · 考卷 · 解答 · 家教教材</p>
    <p class="stat"><strong>${today}</strong> / ${goal} 題今天</p>
    <p class="meta">${days ? `連續 ${days} 天有練習` : today ? '今天已經開始' : '今天的第一題還沒送出'} · 認出 ${parsed.questions.length} 題</p>
    <p>${esc(coach)}</p>
    ${doc.quizId ? `<button type="button" data-mode="quiz" data-doc="${doc.quizId}">做測驗卷</button>` : ''}
    ${doc.lessonId ? `<button type="button" data-mode="read" data-doc="${doc.lessonId}">看教材</button>` : ''}
    ${nextButtons(doc, docWrongs, submission)}
    ${outline.length ? `<p class="kicker">段落</p><ul class="outline">${outline.map((item) => `<li><button type="button" data-goto="${esc(item)}">${esc(plainOutline(item))}</button></li>`).join('')}</ul>` : ''}
    ${state.mode === 'mark' ? `<p class="kicker">這份畫記</p>${marks.length ? `<ul class="mark-list">${marks.map((mark) => `<li><span class="clip">${esc(mark.text)}</span><button type="button" class="icon-btn" data-del-mark="${mark.id}" aria-label="移除畫記">×</button></li>`).join('')}</ul>` : '<p class="hint">選取一句話，再選顏色。點畫記可以刪掉。</p>'}` : ''}
  `;
}

function nextButtons(doc, docWrongs, submission) {
  if (doc.kind === 'review') return '<button type="button" data-mode="grade">看這次批改</button>';
  if (!submission) return '<button type="button" data-mode="quiz">開始作答</button>';
  if (docWrongs.length) return `<button type="button" data-act="retry-doc">只練這 ${docWrongs.length} 題錯題</button>`;
  return '<button type="button" data-mode="tutor">請家教出幾個口頭題</button>';
}

function renderView() {
  const view = document.querySelector('#view');
  if (state.view === 'home') {
    view.innerHTML = renderHome();
    return;
  }
  const { doc, parsed } = active();
  if (!doc) {
    view.innerHTML = '<p class="empty">還沒有教材。</p>';
    return;
  }
  if (state.mode === 'quiz') view.innerHTML = renderQuiz(doc, parsed);
  else if (state.mode === 'grade') view.innerHTML = renderGrade(doc, parsed);
  else if (state.mode === 'wrong') view.innerHTML = renderWrongs();
  else if (state.mode === 'tutor') view.innerHTML = renderTutor(doc, parsed);
  else view.innerHTML = renderReading(doc, parsed);
}

function renderHome() {
  const lines = SATELLITES.map((item) => {
    const point = polar(item.angle, 38);
    return `<line x1="50" y1="50" x2="${point.x}" y2="${point.y}"></line>`;
  }).join('');
  const nodes = SATELLITES.map((item) => {
    const point = polar(item.angle, 38);
    return `<button type="button" class="sat" style="left:${point.x}%;top:${point.y}%" data-mode="${item.mode}" data-doc="slide">${ICONS[item.mode]}<span>${item.label}</span></button>`;
  }).join('');
  const today = todayCount(state.data.gradedLog);
  return `
    <section class="hero">
      <div>
        <p class="eyebrow">HACKDAY · 打造個人化學習</p>
        <h1>一份 Markdown，就是一整套學習工具</h1>
        <p class="lead">同一份檔案同時是筆記、考卷、解答和家教的教材。寫成空格或 (A)(B)，系統就認得是題目。錯題會再變回一份 Markdown。</p>
        <div class="hero-actions">
          <button type="button" data-doc="math2" data-mode="read">高一數學第二章教材</button>
          <button type="button" data-doc="math2-quiz" data-mode="quiz">第二章測驗卷</button>
          <button type="button" data-doc="codex1" data-mode="read">Codex 第1章教材</button>
          <button type="button" data-doc="codex1-quiz" data-mode="quiz">第1章測驗卷</button>
          <button type="button" data-doc="slide" data-mode="read">看投影片同款寫法</button>
          <button type="button" data-doc="feelings" data-mode="read">感受形容詞</button>
          <button type="button" data-doc="yushan" data-mode="read">台灣的高山</button>
          <button type="button" data-doc="rhythm" data-mode="read">二十分鐘讀法</button>
          <button type="button" data-act="browse">開啟自己的 .md</button>
          <button type="button" data-act="compose">編寫教材</button>
        </div>
        <p class="home-foot">${today ? `今天已經練習 ${today} 題。` : '今天還沒開始。'} 從中間的檔案，或外圈任何一種用法進去。墨習不是 eZstudy，只借用「一份檔案、多種用法」這個架構。</p>
      </div>
      <div class="orbit" aria-label="一份 Markdown 展開成六種學習工具">
        <svg class="spokes" viewBox="0 0 100 100">${lines}</svg>
        ${nodes}
        <button type="button" class="core" data-mode="read" data-doc="slide"><small>.md 文件</small><strong>一份檔案</strong></button>
      </div>
    </section>
  `;
}

function docToolbar(doc, parsed) {
  const tags = docTags(doc.id);
  const panel = state.tagOpen
    ? `<div class="tag-panel">${tags.map((tag) => `<button type="button" data-del-tag="${esc(tag)}">${esc(tag)} ×</button>`).join('') || '<span class="hint">還沒有標籤</span>'}<form class="tag-form"><input name="tag" maxlength="16" placeholder="新增標籤" autocomplete="off"><button type="submit">加上</button></form></div>`
    : '';
  return `<div class="docbar" aria-label="這份教材">
      <button type="button" data-act="tags"${state.tagOpen ? ' class="is-on"' : ''}>標籤${tags.length ? ` ${tags.length}` : ''}</button>
      <button type="button" data-act="edit-md">.md</button>
      <button type="button" data-act="save-doc">儲存</button>
      <button type="button" data-act="export-doc">匯出</button>
      <span class="docbar-gap"></span>
      <button type="button" data-insert="code-toggle">代碼</button>
      <button type="button" data-insert="table-toggle">表格</button>
      <button type="button" data-insert="math-block">數學</button>
      <button type="button" data-insert="uml-toggle">Mermaid</button>
    </div>${panel}<p class="doc-meta">${esc(parsed.title)} · 認出 ${parsed.questions.length} 題${tags.length ? ` · ${esc(tags.join('、'))}` : ''}</p>`;
}

function renderReading(doc, parsed) {
  const blocks = parsed.blocks.map((block) => {
    if (block.kind === 'note') {
      return `<section class="block prose" data-section="${esc(block.section)}">${renderNote(block.raw)}</section>`;
    }
    const question = block.question;
    return `<article class="q" id="${question.id}" data-section="${esc(question.section)}"><p class="q-flag">系統認出的題目 · 第 ${esc(question.number)} 題 · ${TYPE_LABEL[question.type]}</p><div class="stem">${stemHtml(question, false)}</div>${optionsHtml(question, '', false)}</article>`;
  }).join('');
  const pen = state.mode === 'mark'
    ? `<div class="penbar"><span>選取句子後上色</span><button type="button" data-pen="gold" class="${state.pen === 'gold' ? 'is-on' : ''}">黃色</button><button type="button" data-pen="mint" class="${state.pen === 'mint' ? 'is-on' : ''}">綠色</button><button type="button" data-pen="rose" class="${state.pen === 'rose' ? 'is-on' : ''}">粉色</button><button type="button" data-act="clear-marks">清除這份畫記</button></div>`
    : '';
  return `<div class="reader">${docToolbar(doc, parsed)}<div class="study-grid${state.showSource ? ' is-split' : ''}"><div class="sheet paper">${pen}<p class="recog">這份檔案同時是筆記、考卷、解答和家教教材。改內容請按 .md，會打開另一個編輯畫面。</p>${blocks}</div>${state.showSource ? `<pre class="source">${esc(doc.source)}</pre>` : ''}</div></div>`;
}

function renderQuiz(doc, parsed) {
  const answers = state.data.answers[doc.id] || {};
  const groups = [];
  for (const question of parsed.questions) {
    const last = groups[groups.length - 1];
    if (!last || last.section !== question.section) groups.push({ section: question.section, items: [question] });
    else last.items.push(question);
  }
  const body = groups.map((group) => {
    const note = blurb(parsed, group.section);
    const cards = group.items.map((question) => {
      const value = answers[question.id];
      const extra = question.type === 'short' ? `<input class="short-input" data-qid="${question.id}" data-short="1" value="${esc(typeof value === 'string' ? value : '')}" aria-label="第 ${esc(question.number)} 題答案">` : '';
      return `<article class="q" id="${question.id}"><p class="q-flag">第 ${esc(question.number)} 題 · ${TYPE_LABEL[question.type]}</p><div class="stem">${stemHtml(question, true, value)}</div>${optionsHtml(question, value, true)}${extra}</article>`;
    }).join('');
    return `<section><h2>${esc(group.section || parsed.title)}</h2>${note ? `<p class="blurb">${esc(note)}</p>` : ''}${cards}</section>`;
  }).join('');
  const done = parsed.questions.filter((question) => filled(answers[question.id])).length;
  if (!parsed.questions.length) {
    return `<div class="sheet paper"><p class="empty">這份還沒有被認成題目的段落。編號加上空格、(A)(B) 或問號，就會變成可以作答的題。</p></div>`;
  }
  return `<div class="sheet"><div class="paper">${body}</div><div class="quiz-bar"><span id="quiz-progress">已作答 ${done} / ${parsed.questions.length}</span><span><button type="button" data-act="clear-attempt">清除</button> <button type="button" data-act="submit-quiz">送出批改</button></span></div></div>`;
}

function renderGrade(doc) {
  const submission = state.data.submissions[doc.id];
  if (!submission) {
    return `<div class="sheet paper"><p class="empty">還沒送出。先到「直接作答」，送出後這裡會計分，錯題會進錯題本。</p><button type="button" class="solid" data-mode="quiz">去作答</button></div>`;
  }
  const ratio = submission.graded ? submission.correct / submission.graded : 0;
  const cards = submission.items.map((item) => `
    <article class="q is-${item.status}">
      <p class="q-flag">第 ${esc(item.number)} 題 · ${item.status === 'correct' ? '答對' : item.status === 'wrong' ? '答錯' : '未計分'}</p>
      <div class="stem">${inline(item.stem)}</div>
      <p>你的答案：${esc(item.userLabel)}</p>
      <p>參考答案：${esc(item.expectedLabel)}</p>
      ${item.explanation ? `<p class="why">${esc(item.explanation)}</p>` : ''}
    </article>
  `).join('');
  return `<div class="sheet"><section class="score"><div class="score-ring" style="--p:${ratio}"><span>${submission.correct}</span></div><div><h2>答對 ${submission.correct} / ${submission.graded} 題</h2><p class="meta">${submission.total - submission.graded ? `另有 ${submission.total - submission.graded} 題沒有標準答案。` : '錯的題目已經留在錯題本。'}</p></div></section>${cards}<div class="quiz-bar"><button type="button" data-mode="quiz">回到作答</button><button type="button" data-mode="wrong">打開錯題本</button></div></div>`;
}

function renderWrongs() {
  const wrongs = state.data.wrongs;
  if (!wrongs.length) {
    return `<div class="sheet paper"><p class="empty">錯題本還是空的。作答送出之後，答錯的題會留在這裡，也能再匯出成一份 Markdown。</p><button type="button" class="solid" data-mode="quiz">去做一份</button></div>`;
  }
  const cards = wrongs.map((item) => `
    <article class="wrong-item">
      <div>
        <p class="q-flag">${esc(item.docTitle)} · 第 ${esc(item.number)} 題</p>
        <p>${esc(item.stem)}</p>
        <p class="meta">你答 ${esc(item.userLabel)} · 參考答案 ${esc(item.expectedLabel)}</p>
      </div>
      <button type="button" class="icon-btn" data-del-wrong="${esc(item.id)}" aria-label="移出錯題">×</button>
    </article>
  `).join('');
  return `<div class="sheet paper"><h2>錯題本</h2><p class="meta">${wrongs.length} 題。重練時會編成一份新的 Markdown，答對的會從這裡拿掉。</p><div class="hero-actions"><button type="button" data-act="retry-all">重練全部</button><button type="button" data-act="export-wrongs">匯出 .md</button></div>${cards}</div>`;
}

function suggestions(parsed) {
  const wrongs = state.data.wrongs.filter((item) => item.docTitle === parsed.title);
  const items = [];
  if (wrongs[0]) items.push(`為什麼第 ${wrongs[0].number} 題會錯？`);
  items.push('整理這份教材的重點', '給我今天的閱讀節奏', '我最容易錯在哪裡？');
  if (parsed.questions[0]) items.push(`提示我第 ${parsed.questions[0].number} 題，先不要公布答案`);
  return items;
}

function renderTutor(doc, parsed) {
  const messages = state.data.chats[doc.id] || [];
  const bubbles = messages.map((message) => {
    const quotes = (message.sources || []).map((source) => `<blockquote>${esc(source.label)}：${esc(source.quote)}</blockquote>`).join('');
    const via = message.role === 'assistant' ? `<p class="meta">${message.remote ? '由你設定的模型回答' : '依據這份 Markdown'}</p>` : '';
    return `<div class="bubble ${message.role === 'user' ? 'user' : 'assistant'}">${paragraphs(message.content)}${quotes}${via}</div>`;
  }).join('');
  const pending = state.sending ? '<div class="bubble assistant"><p>正在對這份教材…</p></div>' : '';
  return `<div class="sheet paper"><p class="recog">家教只能根據〈${esc(parsed.title)}〉回答。沒有 API 金鑰時，它會引用筆記裡的句子。</p><div class="chat-log">${bubbles}${pending || (messages.length ? '' : '<p class="empty">可以問某一題為什麼、請它整理重點，或排今天的 20 分鐘。</p>')}</div><div class="chips">${suggestions(parsed).map((item) => `<button type="button" data-suggest="${esc(item)}">${esc(item)}</button>`).join('')}</div><form class="composer"><input id="chat-input" placeholder="例如：為什麼第 1 題選 nervous？" autocomplete="off"><button type="submit">送出</button></form></div>`;
}

function paragraphs(text) {
  return esc(text).split(/\n{2,}/).map((part) => `<p>${part.replace(/\n/g, '<br>')}</p>`).join('');
}

function applyMarks(root, marks) {
  const ordered = [...marks].sort((a, b) => b.text.length - a.text.length);
  for (const mark of ordered) {
    if (!['gold', 'mint', 'rose'].includes(mark.color)) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const index = node.nodeValue.indexOf(mark.text);
      if (index >= 0 && !node.parentElement?.closest('mark')) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + mark.text.length);
        const el = document.createElement('mark');
        el.className = `hl hl-${mark.color}`;
        el.dataset.hid = mark.id;
        try {
          range.surroundContents(el);
        } catch {
          node = walker.nextNode();
          continue;
        }
        break;
      }
      node = walker.nextNode();
    }
  }
}

function addMark(color, text) {
  const value = text.trim();
  if (!value || !['gold', 'mint', 'rose'].includes(color)) return;
  const { doc } = active();
  const list = state.data.marks[doc.id] || (state.data.marks[doc.id] = []);
  if (list.some((mark) => mark.text === value && mark.color === color)) return;
  list.push({ id: `h${Date.now()}`, text: value, color });
  state.pendingSelection = '';
  persist();
  render();
}

function submitQuiz() {
  const { doc, parsed } = active();
  const result = gradeQuiz(parsed.questions, state.data.answers[doc.id] || {});
  state.data.submissions[doc.id] = { ...result, at: Date.now() };
  if (doc.kind === 'review') {
    for (const item of result.items) {
      if (item.status === 'correct') {
        state.data.wrongs = state.data.wrongs.filter((wrong) => !(wrong.stem === item.stem && wrong.answer === item.answer));
      }
    }
  } else {
    const ids = new Set(result.items.map((item) => `${doc.id}:${item.id}`));
    state.data.wrongs = state.data.wrongs.filter((wrong) => !ids.has(wrong.id));
    for (const item of result.items.filter((entry) => entry.status === 'wrong')) {
      state.data.wrongs.push({
        ...item,
        id: `${doc.id}:${item.id}`,
        docId: doc.id,
        docTitle: parsed.title,
        at: Date.now(),
      });
    }
  }
  const date = localDate();
  state.data.gradedLog = state.data.gradedLog.filter((item) => !(item.date === date && item.docId === doc.id));
  state.data.gradedLog.push({ date, docId: doc.id, n: result.graded });
  persist();
  state.mode = 'grade';
  render();
  toast(result.graded ? `答對 ${result.correct} / ${result.graded} 題` : '這份沒有可以計分的標準答案');
}

function openReview(list) {
  if (!list.length) {
    toast('目前沒有錯題');
    return;
  }
  const source = wrongsToMarkdown(list);
  const doc = {
    id: 'review',
    title: '錯題重練',
    filename: '錯題本.md',
    source,
    builtin: false,
    virtual: true,
    kind: 'review',
  };
  state.docs = state.docs.filter((item) => item.id !== 'review');
  state.docs.push(doc);
  openDoc('review', 'quiz');
}

function download(filename, text) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function openEditor(source, docId) {
  const doc = docId ? state.docs.find((item) => item.id === docId) : null;
  state.editingId = doc && !doc.builtin && !doc.virtual ? doc.id : '';
  const input = document.querySelector('#moxi_md_input');
  input.value = source || '';
  input.dispatchEvent(new Event('input'));
  const status = document.querySelector('#moxi_md_status');
  status.textContent = state.editingId
    ? '儲存會更新這份教材'
    : (doc ? '示範教材會另存成我的教材' : '儲存後成為一份新教材');
  document.querySelector('#editor').showModal();
  input.focus();
}

function openEditorInsert(act) {
  const { doc } = active();
  if (!doc) return;
  openEditor(doc.source, doc.id);
  const button = document.querySelector(`#moxi_md_toolbar [data-md-act="${act}"]`);
  button?.click();
}

function saveReading() {
  const { doc } = active();
  if (!doc) return;
  if (doc.builtin || doc.virtual) {
    importText(doc.source, doc.filename || '我的教材.md');
    return;
  }
  toast('這份已經在文件庫。要改內容請按 .md');
}

function saveEditor() {
  const source = document.querySelector('#moxi_md_input').value;
  if (!source.trim()) {
    toast('內容是空的');
    return;
  }
  const existing = state.editingId
    ? state.data.imports.find((item) => item.id === state.editingId)
    : null;
  document.querySelector('#editor').close();
  if (existing) {
    const parsed = parseDocument(source);
    existing.source = source;
    existing.title = parsed.title;
    persist();
    syncDocs();
    openDoc(existing.id, state.view === 'study' ? state.mode : 'read');
    toast(`已儲存〈${parsed.title}〉，認出 ${parsed.questions.length} 題`);
    return;
  }
  importText(source, '編寫的教材.md');
}

async function importText(source, filename) {
  if (source.length > 400000) {
    toast('檔案請小於 400KB');
    return;
  }
  const parsed = parseDocument(source);
  const id = `u-${hash(source)}`;
  const item = { id, title: parsed.title, filename, source, builtin: false };
  state.data.imports = [item, ...state.data.imports.filter((doc) => doc.id !== id)];
  persist();
  syncDocs();
  openDoc(id, 'read');
  toast(`已讀入〈${parsed.title}〉，認出 ${parsed.questions.length} 題`);
}

async function importFile(file) {
  if (!file) return;
  if (file.size > 400000) {
    toast('檔案請小於 400KB');
    return;
  }
  if (file.type && !/text|markdown|json/.test(file.type) && !/\.(md|txt|markdown)$/i.test(file.name)) {
    toast('請丟一份 .md 或 .txt');
    return;
  }
  await importText(await file.text(), file.name);
}

async function sendChat(text) {
  const content = String(text || '').trim();
  if (!content || state.sending) return;
  const { doc, parsed } = active();
  const list = state.data.chats[doc.id] || (state.data.chats[doc.id] = []);
  list.push({ role: 'user', content });
  state.sending = true;
  persist();
  render();
  try {
    const reply = await replyTo({
      parsed,
      source: doc.source,
      wrongs: state.data.wrongs,
      profile: state.data.profile,
      api: state.data.api,
      message: content,
    });
    list.push({
      role: 'assistant',
      content: reply.text,
      sources: reply.sources || [],
      remote: Boolean(reply.remote),
    });
  } catch (error) {
    list.push({ role: 'assistant', content: `家教暫時沒有回答。${error.message || ''}`, sources: [] });
  } finally {
    state.sending = false;
    persist();
    render();
    document.querySelector('#chat-input')?.focus();
  }
}

function gotoSection(name) {
  state.mode = 'read';
  state.view = 'study';
  render();
  const target = [...document.querySelectorAll('[data-section]')].find((node) => node.dataset.section === name);
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function onAnswer(target) {
  const qid = target.dataset.qid;
  if (!qid) return;
  const { doc } = active();
  const bag = state.data.answers[doc.id] || (state.data.answers[doc.id] = {});
  if (target.dataset.blank != null) {
    const current = Array.isArray(bag[qid]) ? bag[qid].slice() : [];
    current[Number(target.dataset.blank)] = target.value;
    bag[qid] = current;
  } else if (target.dataset.short != null) {
    bag[qid] = target.value;
  } else if (target.type === 'checkbox') {
    const selected = [...target.closest('.options').querySelectorAll('input:checked')].map((input) => input.value);
    bag[qid] = selected;
    target.closest('.options')?.querySelectorAll('.opt').forEach((label) => {
      label.classList.toggle('is-picked', Boolean(label.querySelector('input')?.checked));
    });
  } else if (target.type === 'radio') {
    bag[qid] = target.value;
    target.closest('.options')?.querySelectorAll('.opt').forEach((label) => {
      label.classList.toggle('is-picked', label.querySelector('input') === target);
    });
  }
  persist();
  const progress = document.querySelector('#quiz-progress');
  if (progress) {
    const { parsed } = active();
    const done = parsed.questions.filter((question) => filled(bag[question.id])).length;
    progress.textContent = `已作答 ${done} / ${parsed.questions.length}`;
  }
}

function bind() {
  document.body.addEventListener('click', (event) => {
    const delDoc = event.target.closest('[data-del-doc]');
    if (delDoc) {
      const id = delDoc.dataset.delDoc;
      if (!confirm('移除此教材？這份的作答和畫記會一起清掉。')) return;
      state.data.imports = state.data.imports.filter((item) => item.id !== id);
      delete state.data.answers[id];
      delete state.data.submissions[id];
      delete state.data.marks[id];
      delete state.data.chats[id];
      state.data.wrongs = state.data.wrongs.filter((item) => item.docId !== id);
      if (state.activeId === id) state.view = 'home';
      persist();
      syncDocs();
      render();
      return;
    }
    const delWrong = event.target.closest('[data-del-wrong]');
    if (delWrong) {
      state.data.wrongs = state.data.wrongs.filter((item) => item.id !== delWrong.dataset.delWrong);
      persist();
      render();
      return;
    }
    const delMark = event.target.closest('[data-del-mark]');
    if (delMark) {
      const { doc } = active();
      state.data.marks[doc.id] = (state.data.marks[doc.id] || []).filter((item) => item.id !== delMark.dataset.delMark);
      persist();
      render();
      return;
    }
    const pen = event.target.closest('[data-pen]');
    if (pen) {
      state.pen = state.pen === pen.dataset.pen ? '' : pen.dataset.pen;
      render();
      return;
    }
    const hl = event.target.closest('[data-hl]');
    if (hl) {
      addMark(hl.dataset.hl, state.pendingSelection);
      return;
    }
    const suggest = event.target.closest('[data-suggest]');
    if (suggest) {
      sendChat(suggest.dataset.suggest);
      return;
    }
    const goto = event.target.closest('[data-goto]');
    if (goto) {
      gotoSection(goto.dataset.goto);
      return;
    }
    const act = event.target.closest('[data-act]')?.dataset.act;
    if (act === 'browse') document.querySelector('#file-input').click();
    if (act === 'compose') openEditor('');
    if (act === 'edit-md') {
      const { doc } = active();
      if (doc) openEditor(doc.source, doc.id);
    }
    if (act === 'save-doc') saveReading();
    if (act === 'export-doc') {
      const { doc, parsed } = active();
      if (doc) download(`${parsed.title}.md`, doc.source);
    }
    if (act === 'tags') {
      state.tagOpen = !state.tagOpen;
      render();
    }
    const insert = event.target.closest('[data-insert]');
    if (insert) openEditorInsert(insert.dataset.insert);
    const lib = event.target.closest('[data-lib]');
    if (lib) {
      state.libFilter = lib.dataset.lib;
      renderLibrary();
    }
    const delTag = event.target.closest('[data-del-tag]');
    if (delTag) {
      const { doc } = active();
      state.data.tags[doc.id] = docTags(doc.id).filter((tag) => tag !== delTag.dataset.delTag);
      persist();
      render();
    }
    if (act === 'submit-quiz') submitQuiz();
    if (act === 'clear-attempt') {
      const { doc } = active();
      delete state.data.answers[doc.id];
      delete state.data.submissions[doc.id];
      if (doc.kind !== 'review') state.data.wrongs = state.data.wrongs.filter((item) => item.docId !== doc.id);
      persist();
      render();
      toast('已清除這份作答');
    }
    if (act === 'clear-marks') {
      const { doc } = active();
      delete state.data.marks[doc.id];
      persist();
      render();
    }
    if (act === 'retry-doc') openReview(state.data.wrongs.filter((item) => item.docId === state.activeId));
    if (act === 'retry-all') openReview(state.data.wrongs);
    if (act === 'export-wrongs') download('錯題本.md', wrongsToMarkdown(state.data.wrongs));
    const opener = event.target.closest('[data-open]');
    if (opener) openDoc(opener.dataset.open, state.view === 'study' ? state.mode : 'read');
    const modeBtn = event.target.closest('[data-mode]');
    if (modeBtn) openDoc(modeBtn.dataset.doc || state.activeId || 'slide', modeBtn.dataset.mode);
    const mark = event.target.closest('mark.hl');
    if (mark) {
      const { doc } = active();
      state.data.marks[doc.id] = (state.data.marks[doc.id] || []).filter((item) => item.id !== mark.dataset.hid);
      persist();
      render();
    }
    if (!event.target.closest('#hl-pop')) document.querySelector('#hl-pop').hidden = true;
  });

  document.body.addEventListener('input', (event) => onAnswer(event.target));
  document.body.addEventListener('change', (event) => onAnswer(event.target));
  document.body.addEventListener('submit', (event) => {
    if (event.target.matches('.tag-form')) {
      event.preventDefault();
      const input = event.target.querySelector('input');
      const tag = input.value.trim().slice(0, 16);
      const { doc } = active();
      if (!doc || !tag) return;
      const tags = docTags(doc.id);
      if (!tags.includes(tag)) {
        state.data.tags[doc.id] = [...tags, tag];
        persist();
      }
      state.tagOpen = true;
      render();
      return;
    }
    if (event.target.matches('.composer')) {
      event.preventDefault();
      const input = event.target.querySelector('#chat-input');
      sendChat(input.value);
    }
  });
  document.body.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target.id === 'chat-input' && !event.isComposing) {
      event.preventDefault();
      sendChat(event.target.value);
    }
  });
  document.querySelector('#home-btn').addEventListener('click', () => {
    state.view = 'home';
    render();
  });
  document.querySelector('#toggle-source').addEventListener('click', () => {
    state.showSource = !state.showSource;
    if (state.mode !== 'read' && state.mode !== 'mark') state.mode = 'read';
    render();
  });
  document.querySelector('#open-settings').addEventListener('click', () => {
    const { profile, api } = state.data;
    document.querySelector('#set-name').value = profile.name || '';
    document.querySelector('#set-goal').value = profile.goal || 10;
    document.querySelector('#set-base').value = api.baseUrl || '';
    document.querySelector('#set-model').value = api.model || '';
    document.querySelector('#set-key').value = api.key || '';
    document.querySelector('#settings').showModal();
  });
  document.querySelector('#close-settings').addEventListener('click', () => document.querySelector('#settings').close());
  document.querySelector('#save-settings').addEventListener('click', () => {
    state.data.profile.name = document.querySelector('#set-name').value.trim().slice(0, 20);
    state.data.profile.goal = Math.min(100, Math.max(1, Number(document.querySelector('#set-goal').value) || 10));
    state.data.api.baseUrl = document.querySelector('#set-base').value.trim() || 'https://api.openai.com/v1';
    state.data.api.model = document.querySelector('#set-model').value.trim() || 'gpt-4o-mini';
    state.data.api.key = document.querySelector('#set-key').value.trim();
    persist();
    document.querySelector('#settings').close();
    render();
    toast(state.data.api.key ? '已儲存。家教會改走你的模型' : '已儲存。家教仍用這份 Markdown');
  });
  document.querySelector('#clear-data').addEventListener('click', () => {
    if (!confirm('要清除這台瀏覽器上的作答、畫記、錯題、匯入教材和 API 金鑰嗎？')) return;
    state.data = emptyStore();
    persist();
    state.view = 'home';
    state.docs = state.docs.filter((item) => item.id !== 'review');
    syncDocs();
    document.querySelector('#settings').close();
    render();
  });
  document.querySelector('#edit-doc').addEventListener('click', () => {
    const { doc } = active();
    if (doc) openEditor(doc.source, doc.id);
  });
  document.querySelector('#moxi-md-close').addEventListener('click', () => document.querySelector('#editor').close());
  document.querySelector('#moxi-md-save').addEventListener('click', () => saveEditor());
  document.querySelector('#moxi-md-full').addEventListener('click', () => {
    document.querySelector('#editor').classList.toggle('is-full');
  });
  if (typeof initUrdReferenceMarkdown === 'function') {
    initUrdReferenceMarkdown(document, 'moxi_md_input', 'moxi_md_preview', 'moxi_md_toolbar');
  }
  document.querySelector('#lib-search').addEventListener('input', (event) => {
    state.libQuery = event.target.value;
    renderLibrary();
  });
  document.querySelector('#file-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importFile(file);
  });
  document.querySelectorAll('dialog form').forEach((form) => {
    form.addEventListener('submit', (event) => event.preventDefault());
  });
  document.querySelector('#hl-pop').addEventListener('mousedown', (event) => event.preventDefault());
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) await importFile(file);
  });
  document.addEventListener('mouseup', (event) => {
    if (event.target.closest?.('#hl-pop')) return;
    if (state.view !== 'study' || (state.mode !== 'read' && state.mode !== 'mark')) return;
    const selection = document.getSelection();
    const text = selection?.toString().replace(/\s+/g, ' ').trim() || '';
    const sheet = document.querySelector('.sheet');
    const node = selection?.anchorNode;
    if (!text || text.length < 2 || text.length > 180 || !sheet || !node || !sheet.contains(node)) return;
    state.pendingSelection = text;
    if (state.mode === 'mark' && state.pen) {
      addMark(state.pen, text);
      selection.removeAllRanges();
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const pop = document.querySelector('#hl-pop');
    pop.hidden = false;
    const width = 160;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
    let top = rect.bottom + 8;
    if (top > window.innerHeight - 48) top = Math.max(8, rect.top - 48);
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  });
}

async function boot() {
  state.data = loadStore();
  bind();
  try {
    state.builtins = [];
    for (const item of BUILTINS) {
      const response = await fetch(item.file);
      if (!response.ok) throw new Error(String(response.status));
      const source = await response.text();
      state.builtins.push({ ...item, source, builtin: true, filename: item.file });
    }
    syncDocs();
    render();
  } catch {
    document.querySelector('#view').innerHTML = '<div class="hero"><div><h1>請用伺服器開啟</h1><p class="lead">直接雙擊 index.html 時，瀏覽器會擋住教材檔。請在這個資料夾執行 <code>py server.py</code>，再開啟它印出的網址。</p></div></div>';
  }
}

boot();
