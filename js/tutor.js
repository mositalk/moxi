import { resolveMcq } from './grade.js';

function sentences(raw) {
  return String(raw || '')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .replace(/^(?:答案|正解|解析|說明|關鍵詞)\s*[:：].*$/gm, '')
    .split(/(?<=[。！？!?])\s*/)
    .map((item) => item.replace(/[*_`>#-]/g, '').trim())
    .filter((item) => item.length >= 8);
}

function tokens(text) {
  const source = String(text || '').toLowerCase();
  const words = source.match(/[a-z][a-z'-]{2,}/g) || [];
  const chinese = source.replace(/[^\u3400-\u9fff]/g, '');
  const grams = [];
  for (let i = 0; i < chinese.length - 1; i += 1) grams.push(chinese.slice(i, i + 2));
  return [...words, ...grams];
}

function rank(items, query) {
  const wanted = new Set(tokens(query));
  return items
    .map((item) => {
      const seen = new Set(tokens(item));
      let score = 0;
      for (const token of wanted) if (seen.has(token)) score += 1;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

function findQuestion(parsed, message) {
  const match = message.match(/第\s*(\d+)\s*題/) || message.match(/(?:^|[^\d])(\d+)\s*題/);
  if (!match) return null;
  return parsed.questions.find((question) => question.number === match[1]) || null;
}

function explain(question, parsed, message) {
  const hide = /不要公布|先別|別說答案|不要答案|只給提示|先不要/.test(message);
  const letter = question.type === 'mcq' ? resolveMcq(question) : '';
  const correct = question.options.find((option) => option.key === letter);
  const query = [question.stem, correct?.text || '', question.answer || '', question.explanation || ''].join(' ');
  const pool = parsed.blocks
    .filter((block) => block.kind === 'note')
    .flatMap((block) => sentences(block.raw).map((quote) => ({ quote, label: block.section || '筆記' })));
  const wanted = new Set(tokens(query));
  const picked = pool
    .map((item) => {
      const seen = new Set(tokens(item.quote));
      let score = 0;
      for (const token of wanted) if (seen.has(token)) score += 1;
      if (score && item.label === question.section) score += 1;
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
  const sources = picked.map((item) => ({ label: item.label, quote: item.quote }));
  const parts = [`第 ${question.number} 題在「${question.section || '這份教材'}」。`];
  if (picked.length) {
    parts.push(`同一份筆記裡有這句：\n${picked.map((item) => `「${item.quote}」`).join('\n')}`);
  }
  if (hide) {
    parts.push('答案先留著。把題幹的時間、地點或數字，對回上面那句再答一次。');
  } else if (question.type === 'mcq' && letter) {
    parts.push(`這題選 ${letter}${correct ? ` ${correct.text}` : ''}。`);
    const others = question.options.filter((option) => option.key !== letter).slice(0, 2);
    if (others.length) {
      const names = others.map((option) => option.text).join('、');
      parts.push(others.length > 1
        ? `先不要選 ${names}，它們在這題的情境對不上。`
        : `先不要選 ${names}，這個字在這題的情境對不上。`);
    }
  } else if (question.answer) {
    parts.push(`參考答案是 ${question.answer}。`);
  }
  if (!hide && question.explanation) parts.push(question.explanation);
  return { text: parts.join('\n\n'), sources };
}

function summarize(parsed) {
  const sections = [];
  for (const block of parsed.blocks) {
    if (block.kind !== 'note') continue;
    const heading = block.raw.match(/^#{2,3}\s+(.+)$/m);
    if (!heading) continue;
    const first = sentences(block.raw)[0] || '';
    sections.push({ label: heading[1].replace(/[*_`]/g, ''), quote: first });
  }
  if (!sections.length) {
    return { text: `〈${parsed.title}〉先從標題讀起，再做裡面認出的 ${parsed.questions.length} 題。`, sources: [] };
  }
  const lines = [`〈${parsed.title}〉可以依這幾個段落讀：`, ...sections.map((item) => `- ${item.label}${item.quote ? `：${item.quote}` : ''}`)];
  lines.push(`這份檔案裡認得出 ${parsed.questions.length} 題。讀完一段就做該段的題，不要整份背完才開始。`);
  return {
    text: lines.join('\n\n'),
    sources: sections.filter((item) => item.quote).map((item) => ({ label: item.label, quote: item.quote })),
  };
}

function plan(parsed, wrongs, profile) {
  const name = profile?.name ? `${profile.name}，` : '';
  const mine = wrongs.filter((item) => item.docTitle === parsed.title);
  const counts = new Map();
  for (const item of mine) {
    const key = item.section || '未分章';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const weakest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const goal = profile?.goal || 10;
  const parts = [`${name}今天的目標是完成 ${goal} 題。這份〈${parsed.title}〉可以切成三段：`];
  parts.push('8 分鐘只讀一段，畫記容易混的句子。\n\n8 分鐘把畫記蓋住做題。\n\n4 分鐘只看錯的那幾題，用自己的話講一次。');
  if (weakest) parts.push(`你目前在「${weakest[0]}」累積 ${weakest[1]} 題錯。今天先重讀那一段，不要先換新講義。`);
  else parts.push('還沒有錯題紀錄。先做一遍，錯題會自動留下。');
  return { text: parts.join('\n\n'), sources: [] };
}

function wrongSummary(parsed, wrongs) {
  const mine = wrongs.filter((item) => item.docTitle === parsed.title);
  if (!mine.length) return { text: '這份還沒有錯題。做完一次，答錯的會留在錯題本。', sources: [] };
  const lines = mine.slice(0, 6).map((item) => `- 第 ${item.number} 題：你答 ${item.userLabel}，參考答案是 ${item.expectedLabel}`);
  return {
    text: `這份目前有 ${mine.length} 題在錯題本。\n\n${lines.join('\n')}\n\n可以先問我「為什麼第 ${mine[0].number} 題會錯」。`,
    sources: [],
  };
}

function searchNotes(parsed, message) {
  const pool = parsed.blocks.filter((block) => block.kind === 'note').flatMap((block) => (
    sentences(block.raw).map((quote) => ({ quote, label: block.section || parsed.title }))
  ));
  const found = rank(pool.map((item) => item.quote), message).slice(0, 2);
  if (!found.length) {
    return {
      text: '這份 Markdown 裡沒有直接對上的句子。可以換個教材裡出現過的詞，或指定第幾題。',
      sources: [],
    };
  }
  const sources = found.map((entry) => pool.find((item) => item.quote === entry.item)).filter(Boolean);
  return {
    text: `我先不往教材外面找。這份筆記裡比較近的是：\n\n${sources.map((item) => `「${item.quote}」`).join('\n\n')}`,
    sources: sources.map((item) => ({ label: item.label, quote: item.quote })),
  };
}

export function localReply({ parsed, wrongs = [], profile = {}, message }) {
  const text = String(message || '').trim();
  if (!text) return { text: '先打一個問題，或點下面的建議。', sources: [] };
  const question = findQuestion(parsed, text);
  if (question && /為什麼|提示|解釋|答案|怎麼|不懂|錯/.test(text)) return explain(question, parsed, text);
  if (question) return explain(question, parsed, text);
  if (/重點|整理|摘要|這份在說/.test(text)) return summarize(parsed);
  if (/計畫|節奏|怎麼讀|今天|怎麼開始/.test(text)) return plan(parsed, wrongs, profile);
  if (/錯題|弱點|容易錯|哪裡/.test(text)) return wrongSummary(parsed, wrongs);
  return searchNotes(parsed, text);
}

export async function replyTo({ parsed, source, wrongs, profile, api, message }) {
  if (api?.key) {
    try {
      const remote = await remoteReply({ parsed, source, wrongs, profile, api, message });
      return { text: remote, sources: [], remote: true };
    } catch (error) {
      const local = localReply({ parsed, wrongs, profile, message });
      return {
        text: `模型這次沒有連上（${error.message}）。下面改由這份 Markdown 直接回答。\n\n${local.text}`,
        sources: local.sources,
        remote: false,
      };
    }
  }
  return { ...localReply({ parsed, wrongs, profile, message }), remote: false };
}

async function remoteReply({ parsed, source, wrongs, profile, api, message }) {
  const root = String(api.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
  const endpoint = root.endsWith('/chat/completions') ? root : `${root}/chat/completions`;
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('位址需要是 http 或 https');
  const wrongLine = wrongs
    .filter((item) => item.docTitle === parsed.title)
    .slice(0, 8)
    .map((item) => `第 ${item.number} 題答成 ${item.userLabel}`)
    .join('、');
  const system = [
    '你是學習者的家教。只用下面這份 Markdown 教材回答，不要補教材沒有的事實。',
    '用繁體中文。先指出教材裡的句子，再給答案。學習者如果只要提示，就不要先公布選項字母。',
    profile?.name ? `學習者稱呼：${profile.name}` : '',
    wrongLine ? `這份目前的錯題：${wrongLine}` : '',
    '教材如下：',
    String(source || '').slice(0, 12000),
  ].filter(Boolean).join('\n');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api.key}`,
      },
      body: JSON.stringify({
        model: api.model || 'gpt-4o-mini',
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: message },
        ],
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('沒有內容');
    return String(content).trim();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('逾時');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
