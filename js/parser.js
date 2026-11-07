const QUESTION_RE = /^(?:\*\*)?(\d+)(?:\*\*)?[.、．)]\s*(.*)$/;
const HEAD_RE = /^(#{1,6})\s+(.+?)\s*$/;
const ANSWER_KEY_RE = /^#{1,6}\s*(解答|答案卷|答案|Answers?|Answer\s*Key)\s*$/i;
const ANSWER_RE = /^(?:>\s*)?(?:答案|正解|Answer)\s*[:：]\s*(.*)$/i;
const EXPLAIN_RE = /^(?:>\s*)?(?:解析|說明|Explanation)\s*[:：]\s*(.*)$/i;
const KEYWORD_RE = /^(?:>\s*)?關鍵詞\s*[:：]\s*(.+)$/i;
const OPT_LINE_RE = /^(?:>\s*)?(?:\(([A-Da-d])\)|（([A-Da-d])）|([A-Da-d])[.、．)）])\s+(\S.*)$/;
const BULLET_OPT_RE = /^[-*]\s+(?:\(([A-Da-d])\)|（([A-Da-d])）)\s+(\S.*)$/;
const BLANK_RE = /_{2,}|＿{2,}/;

function plain(text) {
  return String(text || '').replace(/[*_`~]/g, '').trim();
}

function cleanAnswer(text) {
  return String(text || '')
    .trim()
    .replace(/^[*`「」"']+|[*`「」"']+$/g, '')
    .replace(/[。．.]+\s*$/g, '')
    .trim();
}

function pullInlineOptions(line) {
  const re = /(?:\(([A-Da-d])\)|（([A-Da-d])）)\s*([^()（）]*?)(?=\s*(?:\([A-Da-d]\)|（[A-Da-d]）)|$)/g;
  const options = [];
  let match;
  while ((match = re.exec(line))) {
    const text = (match[3] || '').trim().replace(/[。．.]+\s*$/g, '');
    if (!text) continue;
    options.push({ key: (match[1] || match[2]).toUpperCase(), text });
  }
  if (options.length < 2) return { rest: line, options: [] };
  const index = line.search(/\([A-Da-d]\)|（[A-Da-d]）/);
  return { rest: line.slice(0, index).trim(), options };
}

function looksLikeQuestion(lines, index) {
  if (/^\*\*\d+\.\*\*/.test(lines[index].trim())) return true;
  const current = lines[index].match(QUESTION_RE);
  if (!current) return false;
  const windowLines = [lines[index]];
  for (let k = index + 1; k < lines.length && k <= index + 6; k += 1) {
    const trimmed = lines[k].trim();
    if (!trimmed) continue;
    if (QUESTION_RE.test(lines[k]) || HEAD_RE.test(lines[k])) break;
    if (/^```/.test(trimmed) || /^<\/?details\b/i.test(trimmed)) break;
    windowLines.push(lines[k]);
  }
  if (BLANK_RE.test(windowLines.join('\n'))) return true;
  if (windowLines.some((line) => pullInlineOptions(line).options.length >= 2)) return true;
  if (windowLines.slice(1).some((line) => OPT_LINE_RE.test(line.trim()) || BULLET_OPT_RE.test(line.trim()))) {
    return true;
  }
  if (windowLines.some((line) => ANSWER_RE.test(line.trim()) || KEYWORD_RE.test(line.trim()))) return true;
  return /[?？]\s*$/.test(current[2].trim());
}

function optionFromLine(line) {
  const trimmed = line.trim();
  const many = pullInlineOptions(trimmed);
  if (many.options.length >= 2) return many.options;
  const one = trimmed.match(OPT_LINE_RE) || trimmed.match(BULLET_OPT_RE);
  if (!one) return [];
  const key = (one[1] || one[2] || one[3] || '').toUpperCase();
  const text = (one[4] || one[3] || '').trim().replace(/[。．.]+\s*$/g, '');
  if (!key || !text) return [];
  return [{ key, text }];
}

function consumeQuestion(lines, start, section) {
  const head = lines[start].match(QUESTION_RE);
  const stemParts = [head[2]];
  const options = [];
  let answer = '';
  let explanation = '';
  const keywords = [];
  const inline = pullInlineOptions(stemParts[0]);
  if (inline.options.length >= 2) {
    stemParts[0] = inline.rest;
    options.push(...inline.options);
  }

  let i = start + 1;
  for (; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === '&nbsp;') continue;
    if (!trimmed) {
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next += 1;
      if (next >= lines.length) break;
      const nextTrim = lines[next].trim();
      const keep = ANSWER_RE.test(nextTrim) || EXPLAIN_RE.test(nextTrim) || KEYWORD_RE.test(nextTrim)
        || OPT_LINE_RE.test(nextTrim) || BULLET_OPT_RE.test(nextTrim)
        || pullInlineOptions(nextTrim).options.length >= 2;
      if (keep) continue;
      break;
    }
    if (i > start && (QUESTION_RE.test(raw) || (HEAD_RE.test(raw) && !trimmed.startsWith('>')))) break;
    if (ANSWER_KEY_RE.test(trimmed) || /^<\/?details\b/i.test(trimmed) || /^```/.test(trimmed)) break;
    if (/^[-*]\s+/.test(trimmed) && !BULLET_OPT_RE.test(trimmed)) break;

    const answerMatch = trimmed.match(ANSWER_RE);
    if (answerMatch) {
      answer = cleanAnswer(answerMatch[1]);
      continue;
    }
    const explainMatch = trimmed.match(EXPLAIN_RE);
    if (explainMatch) {
      explanation = explainMatch[1].trim();
      continue;
    }
    const keywordMatch = trimmed.match(KEYWORD_RE);
    if (keywordMatch) {
      keywords.push(...keywordMatch[1].split(/[、，,]/).map((item) => item.trim()).filter(Boolean));
      continue;
    }
    const found = optionFromLine(trimmed);
    if (found.length) {
      options.push(...found);
      continue;
    }
    if (!explanation) stemParts.push(trimmed.replace(/^>\s*/, ''));
    else break;
  }

  let stem = stemParts.join('\n').trim();
  const blanks = stem.match(new RegExp(BLANK_RE, 'g'))?.length || 0;
  let type = 'short';
  if (options.length >= 2) type = 'mcq';
  else if (blanks > 0) type = 'cloze';
  else if (/[（(][\s　]*[）)]/.test(stem)) {
    stem = stem.replace(/^[（(][\s　]*[）)]\s*/, '');
    options.push({ key: 'O', text: '正確' }, { key: 'X', text: '錯誤' });
    type = 'mcq';
  }
  return {
    number: head[1],
    stem,
    options,
    answer,
    explanation,
    keywords,
    type,
    blanks,
    section,
    endLine: Math.max(start, i - 1),
  };
}

function cellsOf(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function parseKeyLines(lines) {
  const map = {};
  const ensure = (num) => {
    if (!map[num]) map[num] = { answer: '', explanation: '' };
    return map[num];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim().replace(/^[-*]\s*/, '').replace(/^>\s*/, '');
    if (!trimmed || /^<\/?(details|summary)\b/i.test(trimmed)) continue;
    if (trimmed.includes('|')) {
      const cells = cellsOf(trimmed);
      if (cells[0] === '題號') {
        for (let j = i + 1; j < lines.length && j <= i + 3; j += 1) {
          if (!lines[j].includes('|')) continue;
          const row = cellsOf(lines[j]);
          if (row[0] !== '答案') continue;
          for (let c = 1; c < cells.length; c += 1) {
            if (/^\d+$/.test(cells[c] || '') && row[c]) ensure(cells[c]).answer = cleanAnswer(row[c]);
          }
        }
        continue;
      }
      if (/^\d+$/.test(cells[0] || '') && cells[1] && !/^[-:]+$/.test(cells[1])) {
        const slot = ensure(cells[0]);
        if (!slot.answer) slot.answer = cleanAnswer(cells[1]);
        if (!slot.explanation && cells[2]) slot.explanation = cells[2].trim();
      }
      continue;
    }
    const marked = trimmed.match(/^(\d+)\s*[.、．]\s+\*\*\(?([A-DXOa-dxo])\)?\*\*\s*(.*)$/);
    if (marked) {
      const slot = ensure(marked[1]);
      if (!slot.answer) slot.answer = marked[2].toUpperCase();
      if (marked[3].trim()) slot.explanation = marked[3].trim();
      continue;
    }
    const rubric = trimmed.match(/^\*\*(\d+)\.\*\*\s*(.*)$/);
    if (rubric) {
      const slot = ensure(rubric[1]);
      const parts = [];
      if (rubric[2].trim()) parts.push(rubric[2].trim());
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j].trim();
        if (!next) {
          if (parts.length) break;
          continue;
        }
        if (/^\*\*\d+\.\*\*/.test(next) || /^#{1,6}\s/.test(next)) break;
        if (next.startsWith('|')) {
          const row = cellsOf(next);
          if (row[0] && row[0] !== '要點' && !/^[-:]+$/.test(row[0])) parts.push(row[0]);
          continue;
        }
        parts.push(next.replace(/<[^>]+>/g, ''));
      }
      if (parts.length) slot.explanation = parts.join(' ').replace(/\s+/g, ' ').trim();
      continue;
    }
    const match = trimmed.match(/^(\d+)\s*[.、．:：)）]\s*(.+)$/);
    if (!match) continue;
    const slot = ensure(match[1]);
    if (!slot.answer) slot.answer = cleanAnswer(match[2]);
  }
  return map;
}

function applyKeys(questions, maps) {
  for (const map of maps) {
    for (const question of questions) {
      const hit = map[question.number];
      if (!hit) continue;
      if (!question.answer) question.answer = hit.answer;
      if (!question.explanation && hit.explanation) question.explanation = hit.explanation;
    }
  }
}

function preprocess(markdown) {
  return String(markdown || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');
}

export function parseDocument(markdown) {
  const text = preprocess(markdown);
  if (!text.trim()) return { title: '未命名教材', blocks: [], questions: [] };

  const lines = text.split('\n');
  const blocks = [];
  const questions = [];
  const keys = [];
  let section = '';
  let title = '';
  let noteBuf = [];
  let fence = false;

  function flushNote() {
    const raw = noteBuf.join('\n').trim();
    noteBuf = [];
    if (!raw) return;
    blocks.push({
      kind: 'note',
      id: `n${blocks.length}`,
      section,
      raw,
    });
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('```')) {
      if (!fence && noteBuf.length === 0) noteBuf = [];
      fence = !fence;
      noteBuf.push(line);
      i += 1;
      continue;
    }
    if (fence) {
      noteBuf.push(line);
      i += 1;
      continue;
    }

    if (/^<details\b/i.test(trimmed)) {
      flushNote();
      const collected = [];
      let summary = '';
      if (/<summary>/i.test(trimmed)) summary += trimmed.replace(/<[^>]+>/g, '');
      i += 1;
      for (; i < lines.length; i += 1) {
        if (/^<\/details>/i.test(lines[i].trim())) break;
        if (/<summary>/i.test(lines[i])) {
          summary += lines[i].replace(/<[^>]+>/g, '');
          continue;
        }
        collected.push(lines[i]);
      }
      i += 1;
      if (/解答|答案|answer/i.test(summary)) keys.push(parseKeyLines(collected));
      else if (collected.some((item) => item.trim())) {
        noteBuf.push(collected.map((item) => item.replace(/<[^>]+>/g, '')).join('\n'));
      }
      continue;
    }

    if (ANSWER_KEY_RE.test(trimmed)) {
      flushNote();
      const collected = [];
      i += 1;
      for (; i < lines.length; i += 1) {
        if (HEAD_RE.test(lines[i]) && !ANSWER_KEY_RE.test(lines[i].trim())) break;
        collected.push(lines[i]);
      }
      keys.push(parseKeyLines(collected));
      continue;
    }

    if (HEAD_RE.test(line)) {
      flushNote();
      const heading = line.match(HEAD_RE);
      section = plain(heading[2]);
      if (!title && heading[1].length === 1) title = section;
      noteBuf.push(line);
      i += 1;
      continue;
    }

    if (trimmed === '&nbsp;') {
      i += 1;
      continue;
    }

    if (looksLikeQuestion(lines, i)) {
      flushNote();
      const question = consumeQuestion(lines, i, section);
      const next = question.endLine + 1;
      delete question.endLine;
      question.id = `q${questions.length + 1}`;
      questions.push(question);
      blocks.push({ kind: 'question', id: question.id, section, question });
      i = next;
      continue;
    }

    noteBuf.push(line);
    i += 1;
  }

  flushNote();
  applyKeys(questions, keys);
  return {
    title: title || '未命名教材',
    blocks,
    questions,
  };
}
