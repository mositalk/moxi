export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function renderMath(tex, display) {
  const source = String(tex || '').trim();
  if (typeof katex !== 'undefined' && katex.renderToString) {
    try {
      return katex.renderToString(source, { throwOnError: false, displayMode: display });
    } catch {
      return `<span class="math">${esc(source)}</span>`;
    }
  }
  return `<span class="math${display ? ' is-display' : ''}">${esc(source)}</span>`;
}

export function inline(raw) {
  const maths = [];
  let src = String(raw ?? '').replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => {
    maths.push(renderMath(tex, true));
    return `\u0001${maths.length - 1}\u0001`;
  }).replace(/\$([^$\n]+?)\$/g, (_, tex) => {
    maths.push(renderMath(tex, false));
    return `\u0001${maths.length - 1}\u0001`;
  });
  const codes = [];
  let text = esc(src).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/_{2,}|＿{2,}/g, '<span class="gap"></span>');
  text = text.replace(/(^|[\s（(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codes[index]}</code>`);
  text = text.replace(/\u0001(\d+)\u0001/g, (_, index) => maths[index]);
  return text;
}

function isTableSep(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

export function renderNote(raw) {
  const lines = String(raw || '').split('\n');
  let html = '';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      i += 1;
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line.trim())) {
      html += '<hr>';
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      html += `<blockquote>${buf.map((item) => `<p>${inline(item)}</p>`).join('')}</blockquote>`;
      continue;
    }
    if (i + 1 < lines.length && line.includes('|') && isTableSep(lines[i + 1])) {
      const headers = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      html += `<table><thead><tr>${headers.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${
        rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i += 1;
      }
      html += `<ul>${buf.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
      continue;
    }
    if (/^\s*\d+[.、．)]\s+/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*\d+[.、．)]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+[.、．)]\s+/, ''));
        i += 1;
      }
      html += `<ol>${buf.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`;
      continue;
    }
    const buf = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>\s?|\s*[-*]\s+|\s*\d+[.、．)]\s+|-{3,}|\*{3,})/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i].trim());
      i += 1;
    }
    html += `<p>${inline(buf.join(' '))}</p>`;
  }
  return html;
}
