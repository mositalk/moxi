export function norm(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace(/[。．.，,、！!？?：:；;「」"'“”‘’()（）]/g, '');
}

export function sameText(expected, actual) {
  const answer = norm(expected);
  const given = norm(actual);
  if (!answer || !given) return false;
  if (answer === given) return true;
  if (/^\d+$/.test(answer) && (given.startsWith(answer) || given.endsWith(answer))) return true;
  if (/[\u3400-\u9fff]/.test(answer) && answer.length >= 2 && given.includes(answer)) return true;
  return answer.length >= 4 && given.includes(answer);
}

export function resolveMcq(question) {
  const raw = String(question.answer || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/[()（）.\s。．]/g, '');
  if (/^[A-DXOa-dxo]$/.test(compact)) return compact.toUpperCase();
  const exact = question.options.find((option) => norm(option.text) === norm(raw));
  if (exact) return exact.key;
  const lead = raw.match(/^\s*[（(]?([A-Da-d])(?:[）)]|[.、．:：])/);
  if (lead) return lead[1].toUpperCase();
  const spaced = raw.match(/^\s*([A-Da-d])\s+\S/);
  if (spaced) return spaced[1].toUpperCase();
  const included = question.options.find((option) => norm(option.text).length >= 3 && norm(raw).includes(norm(option.text)));
  return included ? included.key : '';
}

function alternatives(answer) {
  return String(answer || '')
    .split(/\s*[/／|]\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitToCount(answer, count) {
  const separators = ['、', '，', ',', '；', ';', '|', '/', '／'];
  for (const separator of separators) {
    const parts = String(answer || '').split(separator).map((item) => item.trim()).filter(Boolean);
    if (parts.length === count) return parts;
  }
  return [String(answer || '').trim()];
}

function isEmpty(value) {
  if (Array.isArray(value)) return value.length === 0 || value.every((item) => !String(item ?? '').trim());
  return !String(value ?? '').trim();
}

function asList(value) {
  if (Array.isArray(value)) return value;
  return [value ?? ''];
}

export function expectedLabel(question) {
  if (question.type === 'mcq') {
    const letter = resolveMcq(question);
    const option = question.options.find((item) => item.key === letter);
    if (letter) return option ? `${letter} ${option.text}` : letter;
  }
  return question.answer || '（沒有標準答案）';
}

export function userLabel(question, value) {
  if (isEmpty(value)) return '（未作答）';
  if (question.type === 'mcq') {
    const letter = String(value).trim().toUpperCase().match(/^[A-DXO]$/)?.[0]
      || String(value).trim().toUpperCase().match(/[A-D]/)?.[0]
      || String(value).trim();
    const option = question.options.find((item) => item.key === letter);
    return option ? `${letter} ${option.text}` : letter;
  }
  if (Array.isArray(value)) return value.map((item) => item || '＿').join('、');
  return String(value);
}

function keywordsPass(question, value) {
  if (!question.keywords?.length) return false;
  const blob = norm(Array.isArray(value) ? value.join('') : value);
  return question.keywords.every((keyword) => blob.includes(norm(keyword)));
}

export function judge(question, value) {
  const gradable = Boolean(question.answer || question.keywords?.length);
  if (!gradable) {
    return { status: 'ungraded', userLabel: userLabel(question, value), expectedLabel: '（沒有標準答案）' };
  }
  if (isEmpty(value)) {
    return { status: 'wrong', userLabel: '（未作答）', expectedLabel: expectedLabel(question) };
  }
  if (question.type === 'mcq') {
    const want = resolveMcq(question);
    const rawGot = String(Array.isArray(value) ? value[0] : value).trim().toUpperCase();
    const got = rawGot.match(/^[A-DXO]$/)?.[0] || rawGot.match(/[A-D]/)?.[0] || '';
    if (!want) return { status: 'ungraded', userLabel: userLabel(question, value), expectedLabel: question.answer };
    return {
      status: want === got ? 'correct' : 'wrong',
      userLabel: userLabel(question, value),
      expectedLabel: expectedLabel(question),
    };
  }
  if (question.type === 'cloze' && question.blanks > 1) {
    const expectedParts = splitToCount(question.answer, question.blanks);
    const got = asList(value);
    if (expectedParts.length === question.blanks && expectedParts.every((part, index) => sameText(part, got[index] || ''))) {
      return { status: 'correct', userLabel: userLabel(question, value), expectedLabel: expectedLabel(question) };
    }
  }
  const single = Array.isArray(value) ? value.join('') : value;
  if (keywordsPass(question, value) || alternatives(question.answer).some((item) => sameText(item, single))) {
    return { status: 'correct', userLabel: userLabel(question, value), expectedLabel: expectedLabel(question) };
  }
  return { status: 'wrong', userLabel: userLabel(question, value), expectedLabel: expectedLabel(question) };
}

export function gradeQuiz(questions, responses) {
  const items = questions.map((question) => {
    const judged = judge(question, responses?.[question.id]);
    return {
      id: question.id,
      number: question.number,
      section: question.section,
      type: question.type,
      stem: question.stem,
      options: question.options,
      blanks: question.blanks,
      answer: question.answer,
      keywords: question.keywords,
      explanation: question.explanation,
      ...judged,
    };
  });
  const correct = items.filter((item) => item.status === 'correct').length;
  const graded = items.filter((item) => item.status === 'correct' || item.status === 'wrong').length;
  return { items, correct, graded, total: questions.length };
}

export function wrongsToMarkdown(wrongs) {
  if (!wrongs.length) return '# 錯題本\n\n目前沒有錯題。\n';
  const groups = new Map();
  for (const wrong of wrongs) {
    const key = wrong.docTitle || '錯題';
    const list = groups.get(key) || [];
    list.push(wrong);
    groups.set(key, list);
  }
  let out = '# 錯題本\n\n> 由墨習依作答整理。這份檔案可以再放回墨習練習。\n';
  for (const [title, list] of groups) {
    out += `\n## ${title}\n`;
    list.forEach((wrong, index) => {
      out += `\n${index + 1}. ${wrong.stem}\n`;
      for (const option of wrong.options || []) out += `(${option.key}) ${option.text}\n`;
      if (wrong.answer) out += `答案：${wrong.answer}\n`;
      const why = [wrong.userLabel && wrong.userLabel !== '（未作答）' ? `上次答案：${wrong.userLabel}` : '', wrong.explanation || '']
        .filter(Boolean)
        .join(' ');
      if (why) out += `解析：${why}\n`;
    });
  }
  return `${out.trim()}\n`;
}
