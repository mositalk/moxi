/* urd-markdown.js — 共用 Markdown / Mermaid 工具函式庫 */
function urdMdEscapeHtml(s) {
    return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function urdMdEscapeAttr(s) {
    return urdMdEscapeHtml(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function urdNormalizeMermaidSource(src) {
    var s = (src || "").replace(/\r\n/g, "\n");
    // Normalize invisible/full-width chars often introduced by IME or rich text editors.
    s = s.replace(/\u00a0/g, " ").replace(/\u3000/g, " "); // nbsp / ideographic space
    s = s.replace(/[\u200B-\u200D\uFEFF]/g, ""); // zero-width chars / bom
    s = s.replace(/[\uFF01-\uFF5E]/g, function(ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 65248); // full-width ASCII -> half-width
    });
    var lines = s.split("\n");
    var out = [];
    for (var i = 0; i < lines.length; i++) {
        if (/^\s*\.\.\.\s*$/.test(lines[i])) continue; // tutorial placeholder, not Mermaid syntax
        out.push(lines[i]);
    }
    var merged = out.join("\n").replace(/^\s+|\s+$/g, "");
    if (!merged) return merged;
    // Dedent fenced code that was nested under lists/quotes in markdown.
    var dedentLines = merged.split("\n");
    var minIndent = null;
    for (var j = 0; j < dedentLines.length; j++) {
        var current = dedentLines[j];
        if (!current || /^\s*$/.test(current)) continue;
        var m = current.match(/^[ \t]*/);
        var indent = m ? m[0].length : 0;
        if (minIndent === null || indent < minIndent) minIndent = indent;
    }
    if (minIndent && minIndent > 0) {
        var stripRe = new RegExp("^[ \\t]{0," + minIndent + "}");
        for (var k = 0; k < dedentLines.length; k++) {
            dedentLines[k] = dedentLines[k].replace(stripRe, "");
        }
    }
    return dedentLines.join("\n");
}
function urdTransformMermaidSource(src) {
    var s = urdNormalizeMermaidSource(src);
    if (!s) return s;
    // Normalize legacy graph alias to improve parser compatibility across Mermaid builds.
    s = s.replace(/^\s*graph\s+([TBLR][DTLR]?)\b/i, "flowchart $1");
    // Backward compatibility: convert legacy edge label syntax
    // `A --> [label] B` / `A -->[label] B` -> `A -->|label| B`
    s = s.replace(
        /^(\s*[A-Za-z0-9_]+)\s*-->\s*\[([^\]\r\n]+)\]\s*([A-Za-z0-9_][^\r\n]*)$/gm,
        function(_, from, label, to) {
            return from + " -->|" + String(label).replace(/^\s+|\s+$/g, "") + "| " + to;
        }
    );
    // Backward compatibility: convert legacy edge label syntax
    // `A --label--> B` / `A -- label --> B` -> `A -->|label| B`
    s = s.replace(
        /^(\s*[A-Za-z0-9_]+)\s*--\s*([^-][\s\S]*?)\s*-->\s*([A-Za-z0-9_][^\r\n]*)$/gm,
        function(_, from, label, to) {
            var t = String(label || "").replace(/^\s+|\s+$/g, "");
            if (!t) return from + " --> " + to;
            return from + " -->|" + t + "| " + to;
        }
    );
    // usecaseDiagram: pass through as-is - Mermaid 11.x supports it natively
    return s;
}
function urdSimpleFlowEscapeXml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function urdSimpleFlowParseNodeToken(token) {
    var t = (token || "").replace(/^\s+|\s+$/g, "");
    if (!t) return null;
    var m = t.match(/^([A-Za-z0-9_]+)\s*(.*)$/);
    var id = "";
    var rest = "";
    if (m) {
        id = m[1];
        rest = (m[2] || "").replace(/^\s+|\s+$/g, "");
    } else {
        id = t.replace(/[^A-Za-z0-9_]/g, "_");
        rest = "";
    }
    var shape = "rect";
    var label = id;
    if (/^\[\s*[\s\S]*\s*\]$/.test(rest)) {
        shape = "rect";
        label = rest.replace(/^\[\s*|\s*\]$/g, "");
    } else if (/^\{\s*[\s\S]*\s*\}$/.test(rest)) {
        shape = "diamond";
        label = rest.replace(/^\{\s*|\s*\}$/g, "");
    } else if (/^\(\(\s*[\s\S]*\s*\)\)$/.test(rest)) {
        shape = "circle";
        label = rest.replace(/^\(\(\s*|\s*\)\)$/g, "");
    } else if (/^\(\s*[\s\S]*\s*\)$/.test(rest)) {
        shape = "round";
        label = rest.replace(/^\(\s*|\s*\)$/g, "");
    } else if (rest) {
        label = rest;
    }
    label = (label || id).replace(/^\s+|\s+$/g, "");
    label = label.replace(/^["']|["']$/g, "");
    return { id: id, label: label || id, shape: shape };
}
function urdBuildSimpleFlowSvg(src) {
    var s = urdNormalizeMermaidSource(src || "");
    if (!s) return "";
    var lines = s.split("\n");
    if (!lines.length) return "";
    var first = (lines[0] || "").replace(/^\s+|\s+$/g, "");
    var mDir = first.match(/^(?:flowchart|graph)\s+([A-Za-z]{2})\b/i);
    if (!mDir) return "";
    var dir = (mDir[1] || "TD").toUpperCase();
    var isLR = (dir === "LR" || dir === "RL");
    var nodes = [];
    var nodeMap = {};
    var edges = [];
    function ensureNode(tok) {
        var parsed = urdSimpleFlowParseNodeToken(tok);
        if (!parsed || !parsed.id) return null;
        var existing = nodeMap[parsed.id];
        if (!existing) {
            existing = { id: parsed.id, label: parsed.label, shape: parsed.shape };
            nodeMap[parsed.id] = existing;
            nodes.push(existing);
        } else {
            if (existing.label === existing.id && parsed.label) existing.label = parsed.label;
            if (existing.shape === "rect" && parsed.shape !== "rect") existing.shape = parsed.shape;
        }
        return existing;
    }
    for (var i = 1; i < lines.length; i++) {
        var line = (lines[i] || "").replace(/^\s+|\s+$/g, "");
        if (!line || /^%%/.test(line)) continue;
        var mEdge = line.match(/^(.+?)\s*-->\s*(?:\|([^|]+)\|\s*)?(.+)$/);
        if (!mEdge) { ensureNode(line); continue; }
        var from = ensureNode(mEdge[1]);
        var to = ensureNode(mEdge[3]);
        if (!from || !to) continue;
        edges.push({ from: from.id, to: to.id, label: (mEdge[2] || "").replace(/^\s+|\s+$/g, "") });
    }
    if (!nodes.length) return "";
    var nW = 150, nH = 56;
    var gap = 92, margin = 28;
    var width = isLR ? (margin * 2 + nodes.length * nW + (nodes.length - 1) * gap) : 700;
    var height = isLR ? 260 : (margin * 2 + nodes.length * nH + (nodes.length - 1) * gap);
    var pos = {};
    for (var ni = 0; ni < nodes.length; ni++) {
        var x = isLR ? (margin + ni * (nW + gap)) : ((width - nW) / 2);
        var y = isLR ? ((height - nH) / 2) : (margin + ni * (nH + gap));
        pos[nodes[ni].id] = { x: x, y: y, cx: x + nW / 2, cy: y + nH / 2 };
    }
    var svg = [];
    svg.push("<svg xmlns='http://www.w3.org/2000/svg' width='" + width + "' height='" + height + "' viewBox='0 0 " + width + " " + height + "'>");
    svg.push("<defs><marker id='urdFlowArrow' markerWidth='10' markerHeight='8' refX='9' refY='4' orient='auto' markerUnits='strokeWidth'><path d='M0,0 L10,4 L0,8 z' fill='#556270'/></marker></defs>");
    svg.push("<rect x='0' y='0' width='" + width + "' height='" + height + "' fill='#ffffff'/>");
    for (var ei = 0; ei < edges.length; ei++) {
        var e = edges[ei], p1 = pos[e.from], p2 = pos[e.to];
        if (!p1 || !p2) continue;
        var x1 = p1.cx, y1 = p1.cy, x2 = p2.cx, y2 = p2.cy;
        if (isLR) {
            x1 = p1.x + nW; y1 = p1.cy;
            x2 = p2.x; y2 = p2.cy;
        } else {
            x1 = p1.cx; y1 = p1.y + nH;
            x2 = p2.cx; y2 = p2.y;
        }
        svg.push("<line x1='" + x1 + "' y1='" + y1 + "' x2='" + x2 + "' y2='" + y2 + "' stroke='#556270' stroke-width='1.6' marker-end='url(#urdFlowArrow)'/>");
        if (e.label) {
            var lx = Math.round((x1 + x2) / 2), ly = Math.round((y1 + y2) / 2) - 6;
            svg.push("<text x='" + lx + "' y='" + ly + "' text-anchor='middle' font-size='12' fill='#334155'>" + urdSimpleFlowEscapeXml(e.label) + "</text>");
        }
    }
    for (var si = 0; si < nodes.length; si++) {
        var n = nodes[si], p = pos[n.id];
        if (!p) continue;
        if (n.shape === "diamond") {
            var cx = p.cx, cy = p.cy;
            svg.push("<polygon points='" + cx + "," + (p.y) + " " + (p.x + nW) + "," + cy + " " + cx + "," + (p.y + nH) + " " + p.x + "," + cy + "' fill='#fff7ed' stroke='#fb923c' stroke-width='1.4'/>");
        } else if (n.shape === "circle") {
            var r = Math.min(nW, nH) / 2 - 4;
            svg.push("<circle cx='" + p.cx + "' cy='" + p.cy + "' r='" + r + "' fill='#ecfeff' stroke='#06b6d4' stroke-width='1.4'/>");
        } else if (n.shape === "round") {
            svg.push("<rect x='" + p.x + "' y='" + p.y + "' width='" + nW + "' height='" + nH + "' rx='16' ry='16' fill='#eef2ff' stroke='#6366f1' stroke-width='1.4'/>");
        } else {
            svg.push("<rect x='" + p.x + "' y='" + p.y + "' width='" + nW + "' height='" + nH + "' rx='8' ry='8' fill='#f8fafc' stroke='#64748b' stroke-width='1.4'/>");
        }
        svg.push("<text x='" + p.cx + "' y='" + (p.cy + 4) + "' text-anchor='middle' font-size='13' fill='#111827'>" + urdSimpleFlowEscapeXml(n.label) + "</text>");
    }
    svg.push("</svg>");
    return svg.join("");
}
function urdBuildSimpleClassSvg(src) {
    var s = urdNormalizeMermaidSource(src || "");
    if (!s) return "";
    var lines = s.split("\n");
    var first = (lines[0] || "").replace(/^\s+|\s+$/g, "");
    if (!/^classDiagram\b/i.test(first)) return "";
    var classes = [];
    var map = {};
    var edges = [];
    function ensureClass(name) {
        var n = (name || "").replace(/^\s+|\s+$/g, "");
        if (!n) return null;
        if (!map[n]) {
            map[n] = { id: n, members: [] };
            classes.push(map[n]);
        }
        return map[n];
    }
    var current = null;
    for (var i = 1; i < lines.length; i++) {
        var line = (lines[i] || "").replace(/^\s+|\s+$/g, "");
        if (!line || /^%%/.test(line)) continue;
        var mStart = line.match(/^class\s+([A-Za-z0-9_]+)\s*\{$/);
        if (mStart) {
            current = ensureClass(mStart[1]);
            continue;
        }
        if (line === "}") {
            current = null;
            continue;
        }
        var mClass = line.match(/^class\s+([A-Za-z0-9_]+)\s*$/);
        if (mClass) {
            ensureClass(mClass[1]);
            continue;
        }
        var mEdge = line.match(/^([A-Za-z0-9_]+)\s+([\-.<|*o]+)\s+([A-Za-z0-9_]+)(?:\s*:\s*(.+))?$/);
        if (mEdge) {
            ensureClass(mEdge[1]);
            ensureClass(mEdge[3]);
            edges.push({ from: mEdge[1], to: mEdge[3], rel: mEdge[2], label: (mEdge[4] || "") });
            continue;
        }
        if (current) current.members.push(line);
    }
    if (!classes.length) return "";
    var cardW = 190, headH = 30, lineH = 18, gap = 70, margin = 24;
    var maxRows = 1;
    for (var ci = 0; ci < classes.length; ci++) {
        var rows = Math.max(1, classes[ci].members.length);
        if (rows > maxRows) maxRows = rows;
    }
    var cardH = headH + 8 + maxRows * lineH + 10;
    var width = margin * 2 + classes.length * cardW + (classes.length - 1) * gap;
    var height = Math.max(240, margin * 2 + cardH);
    var pos = {};
    for (var pi = 0; pi < classes.length; pi++) {
        var x = margin + pi * (cardW + gap);
        var y = (height - cardH) / 2;
        pos[classes[pi].id] = { x: x, y: y, cx: x + cardW / 2, cy: y + cardH / 2 };
    }
    var svg = [];
    svg.push("<svg xmlns='http://www.w3.org/2000/svg' width='" + width + "' height='" + height + "' viewBox='0 0 " + width + " " + height + "'>");
    svg.push("<defs><marker id='urdClassArrow' markerWidth='10' markerHeight='8' refX='9' refY='4' orient='auto' markerUnits='strokeWidth'><path d='M0,0 L10,4 L0,8 z' fill='#475569'/></marker></defs>");
    for (var ei = 0; ei < edges.length; ei++) {
        var e = edges[ei], p1 = pos[e.from], p2 = pos[e.to];
        if (!p1 || !p2) continue;
        var x1 = p1.x + cardW, y1 = p1.cy;
        var x2 = p2.x, y2 = p2.cy;
        if (x2 < x1) { x1 = p1.x; x2 = p2.x + cardW; }
        svg.push("<line x1='" + x1 + "' y1='" + y1 + "' x2='" + x2 + "' y2='" + y2 + "' stroke='#475569' stroke-width='1.5' marker-end='url(#urdClassArrow)'/>");
        var rel = e.label ? (e.rel + " " + e.label) : e.rel;
        if (rel) {
            svg.push("<text x='" + Math.round((x1 + x2) / 2) + "' y='" + (Math.round((y1 + y2) / 2) - 6) + "' text-anchor='middle' font-size='12' fill='#334155'>" + urdSimpleFlowEscapeXml(rel) + "</text>");
        }
    }
    for (var si = 0; si < classes.length; si++) {
        var c = classes[si], p = pos[c.id];
        svg.push("<rect x='" + p.x + "' y='" + p.y + "' width='" + cardW + "' height='" + cardH + "' rx='8' ry='8' fill='#ffffff' stroke='#64748b' stroke-width='1.4'/>");
        svg.push("<rect x='" + p.x + "' y='" + p.y + "' width='" + cardW + "' height='" + headH + "' rx='8' ry='8' fill='#eef2ff' stroke='#64748b' stroke-width='1.4'/>");
        svg.push("<text x='" + p.cx + "' y='" + (p.y + 20) + "' text-anchor='middle' font-size='13' font-weight='bold' fill='#1e293b'>" + urdSimpleFlowEscapeXml(c.id) + "</text>");
        svg.push("<line x1='" + p.x + "' y1='" + (p.y + headH) + "' x2='" + (p.x + cardW) + "' y2='" + (p.y + headH) + "' stroke='#cbd5e1' stroke-width='1'/>");
        for (var mi = 0; mi < c.members.length; mi++) {
            svg.push("<text x='" + (p.x + 10) + "' y='" + (p.y + headH + 16 + mi * lineH) + "' font-size='12' fill='#334155'>" + urdSimpleFlowEscapeXml(c.members[mi]) + "</text>");
        }
    }
    svg.push("</svg>");
    return svg.join("");
}
function urdBuildSimpleStateSvg(src) {
    var s = urdNormalizeMermaidSource(src || "");
    if (!s) return "";
    var lines = s.split("\n");
    var first = (lines[0] || "").replace(/^\s+|\s+$/g, "");
    if (!/^stateDiagram(?:-v2)?\b/i.test(first)) return "";
    var states = [];
    var map = {};
    var edges = [];
    function normState(n) {
        var t = (n || "").replace(/^\s+|\s+$/g, "");
        if (t === "[*]") return "START_END";
        return t;
    }
    function ensureState(n) {
        var id = normState(n);
        if (!id) return null;
        if (!map[id]) {
            map[id] = { id: id, label: (id === "START_END" ? "[*]" : id) };
            states.push(map[id]);
        }
        return map[id];
    }
    for (var i = 1; i < lines.length; i++) {
        var line = (lines[i] || "").replace(/^\s+|\s+$/g, "");
        if (!line || /^%%/.test(line)) continue;
        var m = line.match(/^(.+?)\s*-->\s*(.+?)(?:\s*:\s*(.+))?$/);
        if (!m) continue;
        var a = ensureState(m[1]), b = ensureState(m[2]);
        if (!a || !b) continue;
        edges.push({ from: a.id, to: b.id, label: (m[3] || "").replace(/^\s+|\s+$/g, "") });
    }
    if (!states.length) return "";
    var nW = 130, nH = 46, gap = 70, margin = 24;
    var width = margin * 2 + states.length * nW + (states.length - 1) * gap;
    var height = 220;
    var pos = {};
    for (var si = 0; si < states.length; si++) {
        var x = margin + si * (nW + gap), y = (height - nH) / 2;
        pos[states[si].id] = { x: x, y: y, cx: x + nW / 2, cy: y + nH / 2 };
    }
    var svg = [];
    svg.push("<svg xmlns='http://www.w3.org/2000/svg' width='" + width + "' height='" + height + "' viewBox='0 0 " + width + " " + height + "'>");
    svg.push("<defs><marker id='urdStateArrow' markerWidth='10' markerHeight='8' refX='9' refY='4' orient='auto' markerUnits='strokeWidth'><path d='M0,0 L10,4 L0,8 z' fill='#475569'/></marker></defs>");
    var pairCount = {};
    function pairKey(a, b) { return a < b ? a + "|" + b : b + "|" + a; }
    for (var ei = 0; ei < edges.length; ei++) {
        var e = edges[ei], p1 = pos[e.from], p2 = pos[e.to];
        if (!p1 || !p2) continue;
        var x1 = p1.x + nW, y1 = p1.cy, x2 = p2.x, y2 = p2.cy;
        if (x2 < x1) { x1 = p1.x; x2 = p2.x + nW; }
        svg.push("<line x1='" + x1 + "' y1='" + y1 + "' x2='" + x2 + "' y2='" + y2 + "' stroke='#475569' stroke-width='1.5' marker-end='url(#urdStateArrow)'/>");
        if (e.label) {
            var pk = pairKey(e.from, e.to);
            pairCount[pk] = (pairCount[pk] || 0);
            var idx = pairCount[pk]++;
            var midY = Math.round((y1 + y2) / 2);
            var yOffset = (idx % 2 === 0) ? -10 : 14;
            svg.push("<text x='" + Math.round((x1 + x2) / 2) + "' y='" + (midY + yOffset) + "' text-anchor='middle' font-size='12' fill='#334155'>" + urdSimpleFlowEscapeXml(e.label) + "</text>");
        }
    }
    for (var ni = 0; ni < states.length; ni++) {
        var n = states[ni], p = pos[n.id];
        if (n.id === "START_END") {
            svg.push("<circle cx='" + p.cx + "' cy='" + p.cy + "' r='16' fill='#111827'/>");
        } else {
            svg.push("<rect x='" + p.x + "' y='" + p.y + "' width='" + nW + "' height='" + nH + "' rx='20' ry='20' fill='#f8fafc' stroke='#64748b' stroke-width='1.4'/>");
            svg.push("<text x='" + p.cx + "' y='" + (p.cy + 4) + "' text-anchor='middle' font-size='13' fill='#111827'>" + urdSimpleFlowEscapeXml(n.label) + "</text>");
        }
    }
    svg.push("</svg>");
    return svg.join("");
}
function urdBuildSimpleErSvg(src) {
    var s = urdNormalizeMermaidSource(src || "");
    if (!s) return "";
    var lines = s.split("\n");
    var first = (lines[0] || "").replace(/^\s+|\s+$/g, "");
    if (!/^erDiagram\b/i.test(first)) return "";
    var ents = [];
    var map = {};
    var edges = [];
    function ensureEnt(n) {
        var id = (n || "").replace(/^\s+|\s+$/g, "");
        if (!id) return null;
        if (!map[id]) { map[id] = { id: id }; ents.push(map[id]); }
        return map[id];
    }
    for (var i = 1; i < lines.length; i++) {
        var line = (lines[i] || "").replace(/^\s+|\s+$/g, "");
        if (!line || /^%%/.test(line)) continue;
        var m = line.match(/^([A-Za-z0-9_]+)\s+([|o}{\-]+)\s+([A-Za-z0-9_]+)(?:\s*:\s*(.+))?$/);
        if (!m) continue;
        ensureEnt(m[1]); ensureEnt(m[3]);
        edges.push({ from: m[1], to: m[3], card: m[2], label: (m[4] || "").replace(/^\s+|\s+$/g, "") });
    }
    if (!ents.length) return "";
    var nW = 160, nH = 52, gap = 80, margin = 24;
    var width = margin * 2 + ents.length * nW + (ents.length - 1) * gap;
    var height = 230;
    var pos = {};
    for (var ei = 0; ei < ents.length; ei++) {
        var x = margin + ei * (nW + gap), y = (height - nH) / 2;
        pos[ents[ei].id] = { x: x, y: y, cx: x + nW / 2, cy: y + nH / 2 };
    }
    var svg = [];
    svg.push("<svg xmlns='http://www.w3.org/2000/svg' width='" + width + "' height='" + height + "' viewBox='0 0 " + width + " " + height + "'>");
    svg.push("<defs><marker id='urdErArrow' markerWidth='10' markerHeight='8' refX='9' refY='4' orient='auto' markerUnits='strokeWidth'><path d='M0,0 L10,4 L0,8 z' fill='#475569'/></marker></defs>");
    for (var li = 0; li < edges.length; li++) {
        var e = edges[li], p1 = pos[e.from], p2 = pos[e.to];
        if (!p1 || !p2) continue;
        var x1 = p1.x + nW, y1 = p1.cy, x2 = p2.x, y2 = p2.cy;
        if (x2 < x1) { x1 = p1.x; x2 = p2.x + nW; }
        svg.push("<line x1='" + x1 + "' y1='" + y1 + "' x2='" + x2 + "' y2='" + y2 + "' stroke='#475569' stroke-width='1.5' marker-end='url(#urdErArrow)'/>");
        var rel = e.card + (e.label ? (" : " + e.label) : "");
        svg.push("<text x='" + Math.round((x1 + x2) / 2) + "' y='" + (Math.round((y1 + y2) / 2) - 6) + "' text-anchor='middle' font-size='12' fill='#334155'>" + urdSimpleFlowEscapeXml(rel) + "</text>");
    }
    for (var ni = 0; ni < ents.length; ni++) {
        var n = ents[ni], p = pos[n.id];
        svg.push("<rect x='" + p.x + "' y='" + p.y + "' width='" + nW + "' height='" + nH + "' rx='6' ry='6' fill='#ecfeff' stroke='#0891b2' stroke-width='1.5'/>");
        svg.push("<text x='" + p.cx + "' y='" + (p.cy + 4) + "' text-anchor='middle' font-size='13' font-weight='bold' fill='#0f172a'>" + urdSimpleFlowEscapeXml(n.id) + "</text>");
    }
    svg.push("</svg>");
    return svg.join("");
}
function urdBuildSimpleSequenceSvg(src) {
    var s = urdNormalizeMermaidSource(src || "");
    if (!s) return "";
    var lines = s.split("\n");
    var first = (lines[0] || "").replace(/^\s+|\s+$/g, "");
    if (!/^sequenceDiagram\b/i.test(first)) return "";
    var actors = [];
    var actorMap = {};
    var msgs = [];
    function ensureActor(name) {
        var n = (name || "").replace(/^\s+|\s+$/g, "");
        if (!n) return null;
        if (!actorMap[n]) {
            actorMap[n] = { id: n };
            actors.push(actorMap[n]);
        }
        return actorMap[n];
    }
    for (var i = 1; i < lines.length; i++) {
        var line = (lines[i] || "").replace(/^\s+|\s+$/g, "");
        if (!line || /^%%/.test(line)) continue;
        var mPart = line.match(/^participant\s+([A-Za-z0-9_\u4e00-\u9fff]+)/i);
        if (mPart) { ensureActor(mPart[1]); continue; }
        var m = line.match(/^([A-Za-z0-9_\u4e00-\u9fff]+)\s*[-.]+>{1,2}\s*([A-Za-z0-9_\u4e00-\u9fff]+)\s*:?[\s]*(.*)$/);
        if (!m) continue;
        ensureActor(m[1]); ensureActor(m[2]);
        msgs.push({ from: m[1], to: m[2], text: (m[3] || "").replace(/^\s+|\s+$/g, "") });
    }
    if (!actors.length) return "";
    var colW = 150, margin = 24, topH = 44, rowH = 34;
    var width = margin * 2 + actors.length * colW;
    var height = topH + Math.max(120, msgs.length * rowH + 36);
    var xMap = {};
    for (var ai = 0; ai < actors.length; ai++) xMap[actors[ai].id] = margin + ai * colW + colW / 2;
    var svg = [];
    svg.push("<svg xmlns='http://www.w3.org/2000/svg' width='" + width + "' height='" + height + "' viewBox='0 0 " + width + " " + height + "'>");
    svg.push("<defs><marker id='urdSeqArrow' markerWidth='10' markerHeight='8' refX='9' refY='4' orient='auto' markerUnits='strokeWidth'><path d='M0,0 L10,4 L0,8 z' fill='#334155'/></marker></defs>");
    for (var pi = 0; pi < actors.length; pi++) {
        var a = actors[pi], x = xMap[a.id], bx = x - 44;
        svg.push("<rect x='" + bx + "' y='8' width='88' height='24' rx='6' ry='6' fill='#eef2ff' stroke='#6366f1' stroke-width='1.2'/>");
        svg.push("<text x='" + x + "' y='24' text-anchor='middle' font-size='12' fill='#1f2937'>" + urdSimpleFlowEscapeXml(a.id) + "</text>");
        svg.push("<line x1='" + x + "' y1='36' x2='" + x + "' y2='" + (height - 10) + "' stroke='#94a3b8' stroke-dasharray='4 3'/>");
    }
    for (var mi = 0; mi < msgs.length; mi++) {
        var m = msgs[mi], y = topH + mi * rowH;
        var x1 = xMap[m.from], x2 = xMap[m.to];
        if (x1 == null || x2 == null) continue;
        svg.push("<line x1='" + x1 + "' y1='" + y + "' x2='" + x2 + "' y2='" + y + "' stroke='#334155' stroke-width='1.4' marker-end='url(#urdSeqArrow)'/>");
        if (m.text) svg.push("<text x='" + Math.round((x1 + x2) / 2) + "' y='" + (y - 6) + "' text-anchor='middle' font-size='12' fill='#334155'>" + urdSimpleFlowEscapeXml(m.text) + "</text>");
    }
    svg.push("</svg>");
    return svg.join("");
}
function urdBuildSimpleUsecaseSvg(src) {
    var s = urdNormalizeMermaidSource(src || "");
    if (!s) return "";
    var lines = s.split("\n");
    var first = (lines[0] || "").replace(/^\s+|\s+$/g, "");
    if (!/^usecaseDiagram\b/i.test(first)) return "";
    var actors = [];
    var actorMap = {};
    var ucs = [];
    var ucMap = {};
    var rels = [];
    function ensureActor(n) {
        var id = (n || "").replace(/^\s+|\s+$/g, "");
        if (!id) return null;
        if (!actorMap[id]) { actorMap[id] = { id: id }; actors.push(actorMap[id]); }
        return actorMap[id];
    }
    function ensureUc(n) {
        var id = (n || "").replace(/^\s+|\s+$/g, "");
        if (!id) return null;
        if (!ucMap[id]) { ucMap[id] = { id: id }; ucs.push(ucMap[id]); }
        return ucMap[id];
    }
    for (var i = 1; i < lines.length; i++) {
        var line = (lines[i] || "").replace(/^\s+|\s+$/g, "");
        if (!line || /^%%/.test(line)) continue;
        var mA = line.match(/^Actor\s+([A-Za-z0-9_\u4e00-\u9fff]+)/i);
        if (mA) { ensureActor(mA[1]); continue; }
        var mR = line.match(/^([A-Za-z0-9_\u4e00-\u9fff]+)\s*-->\s*\(([^)]+)\)\s*$/);
        if (mR) {
            ensureActor(mR[1]); ensureUc(mR[2]);
            rels.push({ actor: mR[1], uc: mR[2] });
        }
    }
    if (!actors.length && !ucs.length) return "";
    if (!actors.length) ensureActor("Actor");
    if (!ucs.length) ensureUc("UseCase");
    var margin = 24, actorW = 120, ucW = 190, ucH = 44, rowGap = 22;
    var rows = Math.max(actors.length, ucs.length);
    var width = 620, height = margin * 2 + rows * ucH + (rows - 1) * rowGap;
    var actorPos = {}, ucPos = {};
    for (var ai = 0; ai < actors.length; ai++) actorPos[actors[ai].id] = { x: 100, y: margin + ai * (ucH + rowGap) + ucH / 2 };
    for (var ui = 0; ui < ucs.length; ui++) ucPos[ucs[ui].id] = { x: 420, y: margin + ui * (ucH + rowGap) + ucH / 2 };
    var svg = [];
    svg.push("<svg xmlns='http://www.w3.org/2000/svg' width='" + width + "' height='" + height + "' viewBox='0 0 " + width + " " + height + "'>");
    svg.push("<defs><marker id='urdUcArrow' markerWidth='10' markerHeight='8' refX='9' refY='4' orient='auto' markerUnits='strokeWidth'><path d='M0,0 L10,4 L0,8 z' fill='#334155'/></marker></defs>");
    for (var ri = 0; ri < rels.length; ri++) {
        var r = rels[ri], ap = actorPos[r.actor], up = ucPos[r.uc];
        if (!ap || !up) continue;
        svg.push("<line x1='" + (ap.x + 24) + "' y1='" + ap.y + "' x2='" + (up.x - 96) + "' y2='" + up.y + "' stroke='#334155' stroke-width='1.4' marker-end='url(#urdUcArrow)'/>");
    }
    for (var p1 = 0; p1 < actors.length; p1++) {
        var a = actors[p1], ap2 = actorPos[a.id];
        svg.push("<circle cx='" + ap2.x + "' cy='" + (ap2.y - 14) + "' r='8' fill='none' stroke='#0f172a' stroke-width='1.3'/>");
        svg.push("<line x1='" + ap2.x + "' y1='" + (ap2.y - 6) + "' x2='" + ap2.x + "' y2='" + (ap2.y + 12) + "' stroke='#0f172a' stroke-width='1.3'/>");
        svg.push("<line x1='" + (ap2.x - 10) + "' y1='" + (ap2.y + 2) + "' x2='" + (ap2.x + 10) + "' y2='" + (ap2.y + 2) + "' stroke='#0f172a' stroke-width='1.3'/>");
        svg.push("<line x1='" + ap2.x + "' y1='" + (ap2.y + 12) + "' x2='" + (ap2.x - 9) + "' y2='" + (ap2.y + 24) + "' stroke='#0f172a' stroke-width='1.3'/>");
        svg.push("<line x1='" + ap2.x + "' y1='" + (ap2.y + 12) + "' x2='" + (ap2.x + 9) + "' y2='" + (ap2.y + 24) + "' stroke='#0f172a' stroke-width='1.3'/>");
        svg.push("<text x='" + ap2.x + "' y='" + (ap2.y + 38) + "' text-anchor='middle' font-size='12' fill='#0f172a'>" + urdSimpleFlowEscapeXml(a.id) + "</text>");
    }
    for (var p2 = 0; p2 < ucs.length; p2++) {
        var u = ucs[p2], up2 = ucPos[u.id];
        svg.push("<ellipse cx='" + up2.x + "' cy='" + up2.y + "' rx='90' ry='22' fill='#fefce8' stroke='#ca8a04' stroke-width='1.4'/>");
        svg.push("<text x='" + up2.x + "' y='" + (up2.y + 4) + "' text-anchor='middle' font-size='12' fill='#1f2937'>" + urdSimpleFlowEscapeXml(u.id) + "</text>");
    }
    svg.push("</svg>");
    return svg.join("");
}
function urdMdEscapeAttr(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function urdMdInline(s) {
    var out = urdMdEscapeHtml(s || "");
    out = out.replace(/\\\(([\s\S]*?)\\\)/g, function(_, m) { return "<span class='urd-katex-inline' data-katex='" + urdMdEscapeAttr(m) + "'></span>"; });
    out = out.replace(/\\\[([\s\S]*?)\\\]/g, function(_, m) { return "<span class='urd-katex-block' data-katex='" + urdMdEscapeAttr(m) + "'></span>"; });
    out = out.replace(/\$\$([\s\S]*?)\$\$/g, function(_, m) { return "<span class='urd-katex-block' data-katex='" + urdMdEscapeAttr(m) + "'></span>"; });
    out = out.replace(/\$([^$\n]+)\$/g, function(_, m) { return "<span class='urd-katex-inline' data-katex='" + urdMdEscapeAttr(m) + "'></span>"; });
    // 圖片帶連結 [![alt](img)](url) - 優先於單純圖片
    out = out.replace(/\[!\[([^\]]*)\]\(([^)]+)\)\]\(((?:https?:\/\/|mailto:|#)[^\s)]*)\)/g, function(_, alt, imgUrl, linkUrl) {
        var tgt = /^#/.test(linkUrl) ? "" : " target='_blank' rel='noopener noreferrer'";
        return "<a href='" + linkUrl.replace(/'/g,"&#39;") + "'" + tgt + "><img src='" + imgUrl.replace(/'/g,"&#39;") + "' alt='" + urdMdEscapeAttr(alt) + "' style='max-width:100%;'></a>";
    });
    out = out.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, function(_, alt, url) { return "<img src='" + url.replace(/'/g, "&#39;") + "' alt='" + urdMdEscapeAttr(alt) + "' style='max-width:100%;'>"; });
    // 自動連結 <https://...> <mailto:...> (已被 escape 成 &lt;...&gt;)
    out = out.replace(/&lt;(https?:\/\/[^\s&<>]+)&gt;/g, "<a href='$1' target='_blank' rel='noopener noreferrer'>$1</a>");
    out = out.replace(/&lt;(mailto:[^\s&<>]+)&gt;/g, "<a href='$1'>$1</a>");
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    // 連結：支援 https/http、mailto、頁內錨點 #
    out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|#)[^\s)]*)\)/g, function(_, text, url) {
        if (/^#/.test(url)) return "<a href='" + url + "'>" + text + "</a>";
        return "<a href='" + url + "' target='_blank' rel='noopener noreferrer'>" + text + "</a>";
    });
    out = out.replace(/&lt;\/sub&gt;/g, "</sub>").replace(/&lt;sub&gt;/g, "<sub>");
    out = out.replace(/&lt;\/sup&gt;/g, "</sup>").replace(/&lt;sup&gt;/g, "<sup>");
    out = out.replace(/&lt;\/mark&gt;/g, "</mark>").replace(/&lt;mark&gt;/g, "<mark>");
    out = out.replace(/&lt;\/u&gt;/g, "</u>").replace(/&lt;u&gt;/g, "<u>");
    out = out.replace(/&lt;\/kbd&gt;/g, "</kbd>").replace(/&lt;kbd&gt;/g, "<kbd>");
    out = out.replace(/&lt;\/abbr&gt;/g, "</abbr>").replace(/&lt;abbr\s+title=&quot;([^&]*)&quot;\s*&gt;/g, "<abbr title=\"$1\">").replace(/&lt;abbr\s+title="([^"]*)"\s*&gt;/g, "<abbr title=\"$1\">");
    return out;
}
function urdRenderMathInPreview(preview) {
    if (!preview || typeof katex === "undefined") return;
    var opts = { throwOnError: false };
    preview.querySelectorAll(".urd-katex-inline").forEach(function(el) {
        var f = el.getAttribute("data-katex");
        if (f) try { katex.render(f, el, opts); } catch (e) { el.textContent = f; }
    });
    preview.querySelectorAll(".urd-katex-block").forEach(function(el) {
        var f = el.getAttribute("data-katex");
        if (f) try { katex.render(f, el, Object.assign({}, opts, { displayMode: true })); } catch (e) { el.textContent = f; }
    });
}
function urdRenderMermaidInPreview(preview) {
    if (!preview) return;
    if (typeof mermaid === "undefined") {
        var ms = preview.querySelectorAll(".urd-md-mermaid");
        for (var mi = 0; mi < ms.length; mi++) {
            ms[mi].innerHTML = "<pre><code>" + urdMdEscapeHtml(ms[mi].textContent || "") + "</code></pre>";
        }
        return;
    }
    if (!window.__urdMermaidInitDone) {
        try {
            mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "default" });
            window.__urdMermaidInitDone = true;
        } catch (e) {}
    }
    var nodes = preview.querySelectorAll(".urd-md-mermaid.mermaid");
    if (!nodes.length) return;
    function tryMermaidCdnFallback(err) {
        var msg = "";
        try {
            if (err && err.message) msg = String(err.message);
            else if (err) msg = String(err);
        } catch (eMsg) {}
        // Skip CDN for Mermaid syntax errors — CDN uses the same parser and won't help.
        var isSyntaxErr = /^\s*(Parse error|Lexical error|Expected\s|Unexpected token)/i.test(msg);
        if (isSyntaxErr) return false;
        if (window.__urdMermaidUsingCdn || window.__urdMermaidFallbackTried) return false;
        window.__urdMermaidFallbackTried = true;
        if (window.__urdMermaidFallbackLoading) return true;
        window.__urdMermaidFallbackLoading = true;
        var s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js";
        s.onload = function() {
            window.__urdMermaidFallbackLoading = false;
            window.__urdMermaidUsingCdn = true;
            window.__urdMermaidInitDone = false;
            setTimeout(function() { urdRenderMermaidInPreview(preview); }, 0);
        };
        s.onerror = function() {
            window.__urdMermaidFallbackLoading = false;
            // CDN failed to load — re-render so nodes fall through to SVG fallback.
            setTimeout(function() { urdRenderMermaidInPreview(preview); }, 0);
        };
        document.head.appendChild(s);
        return true;
    }
    function showMermaidError(node, src, err) {
        if (tryMermaidCdnFallback(err)) {
            node.innerHTML = "<div class='urd-md-mermaid-loading'>Mermaid 本機引擎異常，正在切換備援版本...</div><pre><code>" + urdMdEscapeHtml(src) + "</code></pre>";
            return;
        }
        var raw = node.getAttribute("data-mermaid-raw") || src;
        var svgFallback = (/^usecaseDiagram\b/i.test(raw) ? urdBuildSimpleUsecaseSvg(raw) : null) || urdBuildSimpleFlowSvg(src) || urdBuildSimpleClassSvg(src) || urdBuildSimpleStateSvg(src) || urdBuildSimpleErSvg(src) || urdBuildSimpleSequenceSvg(src) || urdBuildSimpleUsecaseSvg(raw);
        if (svgFallback) {
            node.innerHTML = svgFallback;
            return;
        }
        var msg = "";
        try {
            if (err && err.message) msg = String(err.message);
            else if (err) msg = String(err);
        } catch (eMsg) {}
        if (!msg) msg = "Unknown parser error";
        node.innerHTML = "<div class='urd-md-mermaid-loading' style='color:#b00020;'>Mermaid 語法錯誤：" + urdMdEscapeHtml(msg) + "</div><pre><code>" + urdMdEscapeHtml(src) + "</code></pre>";
    }
    if (!window.__urdMermaidRenderToken) window.__urdMermaidRenderToken = 0;
    var currentToken = ++window.__urdMermaidRenderToken;
    var list = [];
    for (var ni = 0; ni < nodes.length; ni++) list.push(nodes[ni]);
    function isMermaidErrorSvg(svgText) {
        var s = String(svgText || "");
        return /class=["']error-icon["']|Syntax error in text|Parse error|Lexical error|UnknownDiagramError/i.test(s);
    }
    function renderNext(idx) {
        if (currentToken !== window.__urdMermaidRenderToken) return; // stale render task
        if (idx >= list.length) return;
        var node = list[idx];
        var raw = node.getAttribute("data-mermaid-src");
        if (!raw) raw = node.textContent || "";
        node.setAttribute("data-mermaid-raw", raw);
        var src = urdTransformMermaidSource(raw);
        node.setAttribute("data-mermaid-src", src);
        if (!src) {
            node.innerHTML = "<pre><code></code></pre>";
            renderNext(idx + 1);
            return;
        }
        node.innerHTML = "<div class='urd-md-mermaid-loading'>Rendering Mermaid...</div>";
        var renderId = "urd-md-mermaid-" + Date.now() + "-" + idx;
        if (typeof mermaid.render === "function") {
            try {
                var rendered = mermaid.render(renderId, src);
                if (rendered && typeof rendered.then === "function") {
                    rendered.then(function(res) {
                        if (currentToken !== window.__urdMermaidRenderToken) return;
                        if (res && res.svg) {
                            if (isMermaidErrorSvg(res.svg)) {
                                showMermaidError(node, src, new Error("Syntax error in text"));
                            } else {
                                node.innerHTML = res.svg;
                                if (typeof res.bindFunctions === "function") try { res.bindFunctions(node); } catch (e) {}
                            }
                        } else {
                            showMermaidError(node, src, null);
                        }
                    }).catch(function(e1) {
                        if (currentToken !== window.__urdMermaidRenderToken) return;
                        showMermaidError(node, src, e1);
                    }).finally(function() {
                        renderNext(idx + 1);
                    });
                    return;
                }
            } catch (eRender) {
                showMermaidError(node, src, eRender);
                renderNext(idx + 1);
                return;
            }
        }
        if (mermaid.mermaidAPI && typeof mermaid.mermaidAPI.render === "function") {
            try {
                mermaid.mermaidAPI.render(renderId, src, function(svgCode) {
                    if (currentToken !== window.__urdMermaidRenderToken) return;
                    if (svgCode && isMermaidErrorSvg(svgCode)) {
                        showMermaidError(node, src, new Error("Syntax error in text"));
                    } else {
                        node.innerHTML = svgCode || ("<pre><code>" + urdMdEscapeHtml(src) + "</code></pre>");
                    }
                    renderNext(idx + 1);
                });
            } catch (e) {
                showMermaidError(node, src, e);
                renderNext(idx + 1);
            }
            return;
        }
        node.innerHTML = "<pre><code>" + urdMdEscapeHtml(src) + "</code></pre>";
        renderNext(idx + 1);
    }
    renderNext(0);
}
function urdRenderMarkdownToHtml(md) {
    var src = (md || "").replace(/\r\n/g, "\n");
    // 預先提取腳注定義 [^id]: text
    var fnDefs = {}, fnOrder = [];
    src = src.replace(/^\[\^([^\]]+)\]:\s*(.+)$/gm, function(_, id, text) {
        if (!fnDefs[id]) { fnOrder.push(id); fnDefs[id] = { num: fnOrder.length, text: text.trim() }; }
        return "";
    });
    // 預先提取參考式連結定義 [ref]: url "title"
    var refDefs = {};
    src = src.replace(/^\[([^\]]+)\]:\s*(\S+)(?:\s+"([^"]*)")?$/gm, function(_, id, url, title) {
        refDefs[id.toLowerCase()] = { url: url, title: title || "" };
        return "";
    });
    var lines = src.split("\n");
    var html = [];
    var inCode = false;
    var codeLang = "";
    var codeBuf = [];
    var inHtmlTable = false;
    var htmlTableBuf = [];
    var inMathBlock = false;
    var mathBlockBuf = [];
    var inUl = false;
    var inOl = false;
    function closeLists() {
        if (inUl) { html.push("</ul>"); inUl = false; }
        if (inOl) { html.push("</ol>"); inOl = false; }
    }
    function isMdTableRow(line) {
        return /^\s*\|.*\|\s*$/.test(line || "");
    }
    function splitMdTableRow(line) {
        var s = (line || "").replace(/^\s+|\s+$/g, "");
        if (s.charAt(0) === "|") s = s.substring(1);
        if (s.charAt(s.length - 1) === "|") s = s.substring(0, s.length - 1);
        var arr = s.split("|");
        for (var i = 0; i < arr.length; i++) arr[i] = arr[i].replace(/^\s+|\s+$/g, "");
        return arr;
    }
    function isMdTableSep(line) {
        if (!isMdTableRow(line)) return false;
        var cols = splitMdTableRow(line);
        if (!cols.length) return false;
        for (var i = 0; i < cols.length; i++) {
            if (!/^:?-{3,}:?$/.test(cols[i])) return false;
        }
        return true;
    }
    function mdTableAlignToken(token) {
        if (/^:-+:$/.test(token)) return "center";
        if (/^-+:$/.test(token)) return "right";
        return "left";
    }
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (/^\s*(?:```|''')/.test(line)) {
            closeLists();
            if (!inCode) {
                inCode = true;
                codeLang = line.replace(/^\s*(?:```|''')/, "").trim().toLowerCase();
                codeBuf = [];
            } else {
                var codeText = codeBuf.join("\n");
                if (codeLang === "mermaid") {
                    html.push("<div class='urd-md-mermaid-note'>📈 Mermaid 圖</div>");
                    html.push("<div class='urd-md-mermaid-wrap'><div class='urd-md-mermaid-actions'><button type='button' class='urd-mm-btn' data-mm-act='fit' title='適合寬度'>Fit</button><button type='button' class='urd-mm-btn' data-mm-act='zoom-in' title='放大'>+</button><button type='button' class='urd-mm-btn' data-mm-act='zoom-out' title='縮小'>-</button><button type='button' class='urd-mm-btn' data-mm-act='png' title='下載 PNG'>PNG</button><button type='button' class='urd-mm-btn' data-mm-act='svg' title='下載 SVG'>SVG</button><button type='button' class='urd-mm-btn' data-mm-act='copy' title='複製'>複製</button></div><div class='urd-md-mermaid-zoom'><div class='urd-md-mermaid mermaid'>" + urdMdEscapeHtml(codeText) + "</div></div></div>");
                } else {
                    html.push("<pre><code>" + urdMdEscapeHtml(codeText) + "</code></pre>");
                }
                inCode = false;
                codeLang = "";
                codeBuf = [];
            }
            continue;
        }
        if (inCode) {
            codeBuf.push(line);
            continue;
        }
        if (inMathBlock) {
            if (/^\s*\$\$\s*$/.test(line) || /^\s*\\\]\s*$/.test(line)) {
                closeLists();
                var mathSrc = mathBlockBuf.join("\n").replace(/^\s+|\s+$/g, "");
                html.push("<div class='urd-katex-block' data-katex='" + urdMdEscapeAttr(mathSrc) + "'></div>");
                inMathBlock = false;
                mathBlockBuf = [];
            } else {
                mathBlockBuf.push(line);
            }
            continue;
        }
        if (/^\s*\$\$\s*$/.test(line) || /^\s*\\\[\s*$/.test(line)) {
            inMathBlock = true;
            mathBlockBuf = [];
            continue;
        }
        if (inHtmlTable) {
            htmlTableBuf.push(line);
            if (/<\s*\/\s*table\s*>/i.test(line)) {
                closeLists();
                html.push(htmlTableBuf.join("\n"));
                inHtmlTable = false;
                htmlTableBuf = [];
            }
            continue;
        }
        if (/^\s*<\s*table\b/i.test(line)) {
            inHtmlTable = true;
            htmlTableBuf = [line];
            if (/<\s*\/\s*table\s*>/i.test(line)) {
                closeLists();
                html.push(htmlTableBuf.join("\n"));
                inHtmlTable = false;
                htmlTableBuf = [];
            }
            continue;
        }
        if (i + 1 < lines.length && isMdTableRow(line) && isMdTableSep(lines[i + 1])) {
            closeLists();
            var headerCells = splitMdTableRow(line);
            var sepCells = splitMdTableRow(lines[i + 1]);
            var colCount = headerCells.length > sepCells.length ? headerCells.length : sepCells.length;
            var aligns = [];
            for (var ac = 0; ac < colCount; ac++) {
                aligns.push(mdTableAlignToken(sepCells[ac] || "---"));
            }
            html.push("<table><thead><tr>");
            for (var hc = 0; hc < colCount; hc++) {
                html.push("<th style='text-align:" + aligns[hc] + ";'>" + urdMdInline(headerCells[hc] || "") + "</th>");
            }
            html.push("</tr></thead><tbody>");
            i = i + 1; // skip separator row
            while (i + 1 < lines.length && isMdTableRow(lines[i + 1])) {
                i = i + 1;
                var rowCells = splitMdTableRow(lines[i]);
                html.push("<tr>");
                for (var rc = 0; rc < colCount; rc++) {
                    html.push("<td style='text-align:" + aligns[rc] + ";'>" + urdMdInline(rowCells[rc] || "") + "</td>");
                }
                html.push("</tr>");
            }
            html.push("</tbody></table>");
            continue;
        }
        if (/^\s*$/.test(line)) {
            closeLists();
            html.push("");
            continue;
        }
        if (/^\s*[-*_]{3,}\s*$/.test(line)) {
            closeLists();
            html.push("<hr>");
            continue;
        }
        if (/^\s*<div\s[^>]*style\s*=\s*["'][^"']*text-align[^"']*["'][^>]*>/i.test(line)) {
            closeLists();
            var divBuf = [line];
            while (i + 1 < lines.length && !/^\s*<\s*\/\s*div\s*>/i.test(lines[i + 1])) {
                i++;
                var inner = lines[i];
                divBuf.push(inner ? ("<p>" + urdMdInline(inner) + "</p>") : "");
            }
            if (i + 1 < lines.length) { i++; divBuf.push(lines[i]); }
            html.push(divBuf.join("\n"));
            continue;
        }
        var mH = line.match(/^(#{1,3})\s+(.*)$/);
        if (mH) {
            closeLists();
            var lv = mH[1].length;
            html.push("<h" + lv + ">" + urdMdInline(mH[2]) + "</h" + lv + ">");
            continue;
        }
        var mTask = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (mTask) {
            if (inOl) { html.push("</ol>"); inOl = false; }
            if (!inUl) { html.push("<ul class='urd-task-list'>"); inUl = true; }
            var checked = /^[xX]$/.test(mTask[1]);
            html.push("<li class='urd-task-item'>" + (checked ? "<input type='checkbox' disabled checked> " : "<input type='checkbox' disabled> ") + urdMdInline(mTask[2]) + "</li>");
            continue;
        }
        var mUl = line.match(/^\s*[-*]\s+(.*)$/);
        if (mUl) {
            if (inOl) { html.push("</ol>"); inOl = false; }
            if (!inUl) { html.push("<ul>"); inUl = true; }
            html.push("<li>" + urdMdInline(mUl[1]) + "</li>");
            continue;
        }
        var mOl = line.match(/^\s*\d+\.\s+(.*)$/);
        if (mOl) {
            if (inUl) { html.push("</ul>"); inUl = false; }
            if (!inOl) { html.push("<ol>"); inOl = true; }
            html.push("<li>" + urdMdInline(mOl[1]) + "</li>");
            continue;
        }
        var mBq = line.match(/^\s*>\s?(.*)$/);
        if (mBq) {
            closeLists();
            html.push("<blockquote>" + urdMdInline(mBq[1]) + "</blockquote>");
            continue;
        }
        closeLists();
        html.push("<p>" + urdMdInline(line) + "</p>");
    }
    closeLists();
    if (inCode) {
        var tailText = codeBuf.join("\n");
        if (codeLang === "mermaid") {
            html.push("<div class='urd-md-mermaid-note'>📈 Mermaid 圖</div>");
            html.push("<div class='urd-md-mermaid-wrap'><div class='urd-md-mermaid-actions'><button type='button' class='urd-mm-btn' data-mm-act='fit' title='適合寬度'>Fit</button><button type='button' class='urd-mm-btn' data-mm-act='zoom-in' title='放大'>+</button><button type='button' class='urd-mm-btn' data-mm-act='zoom-out' title='縮小'>-</button><button type='button' class='urd-mm-btn' data-mm-act='png' title='下載 PNG'>PNG</button><button type='button' class='urd-mm-btn' data-mm-act='svg' title='下載 SVG'>SVG</button><button type='button' class='urd-mm-btn' data-mm-act='copy' title='複製'>複製</button></div><div class='urd-md-mermaid-zoom'><div class='urd-md-mermaid mermaid'>" + urdMdEscapeHtml(tailText) + "</div></div></div>");
        } else {
            html.push("<pre><code>" + urdMdEscapeHtml(tailText) + "</code></pre>");
        }
    }
    if (inHtmlTable && htmlTableBuf.length) {
        html.push(htmlTableBuf.join("\n"));
    }
    var result = html.join("");
    // 替換參考式連結 [text][ref]
    result = result.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, function(_, text, ref) {
        var key = (ref || text).toLowerCase();
        if (refDefs[key]) {
            var rd = refDefs[key];
            var titleAttr = rd.title ? " title='" + urdMdEscapeAttr(rd.title) + "'" : "";
            return "<a href='" + rd.url + "'" + titleAttr + " target='_blank' rel='noopener noreferrer'>" + text + "</a>";
        }
        return '[' + text + '][' + ref + ']';
    });
    // 替換腳注引用 [^id] → 上標
    result = result.replace(/\[\^([^\]]+)\]/g, function(_, id) {
        if (fnDefs[id]) {
            var n = fnDefs[id].num;
            return '<sup><a href="#fn-' + id + '" id="fnref-' + id + '" style="color:#0366d6;">[' + n + ']</a></sup>';
        }
        return '[^' + id + ']';
    });
    // 附加腳注清單
    if (fnOrder.length > 0) {
        result += '<hr><section class="urd-footnotes"><ol style="font-size:12px;color:#555;padding-left:20px;margin:4px 0;">';
        for (var fi = 0; fi < fnOrder.length; fi++) {
            var fid = fnOrder[fi];
            result += '<li id="fn-' + fid + '" style="margin:2px 0;">' + urdMdInline(fnDefs[fid].text) + ' <a href="#fnref-' + fid + '" style="font-size:11px;">↩</a></li>';
        }
        result += '</ol></section>';
    }
    return result;
}
function urdMdInsert(ta, before, after, placeholder) {
    if (!ta) return;
    ta.focus();
    var start = ta.selectionStart || 0;
    var end = ta.selectionEnd || 0;
    var sel = ta.value.substring(start, end) || (placeholder || "");
    var text = (before || "") + sel + (after || "");
    ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
    var pos = start + text.length;
    ta.setSelectionRange(pos, pos);
}
function urdMdInsertTable(ta, cols, rows) {
    if (!ta) return;
    var header = "|";
    for (var c = 0; c < cols; c++) header += " 欄位" + (c + 1) + " |";
    var sep = "|";
    for (var c = 0; c < cols; c++) sep += " --- |";
    var row = "|";
    for (var c = 0; c < cols; c++) row += " 內容 |";
    var lines = [header, sep];
    for (var r = 0; r < rows; r++) lines.push(row);
    urdMdInsert(ta, "\n" + lines.join("\n") + "\n", "", "");
}
var urdUmlTemplates = {
    "flowchart-td": "## 1. 流程圖 (Flowchart)\n- 用於表示流程、決策、任務順序等。\n- 基本語法：graph LR 或 graph TD 分別表示 左右（Left to Right） 和 上下（Top to Down） 流向。\n\n```mermaid\ngraph TD\n    A[開始] --> B{判斷條件}\n    B -->|是| C[處理1]\n    B -->|否| D[處理2]\n    C --> E[結束]\n    D --> E\n```\n",
    "flowchart-lr": "## 1. 流程圖 (Flowchart)\n- 用於表示流程、決策、任務順序等。\n- 基本語法：graph LR 或 graph TD 分別表示 左右（Left to Right） 和 上下（Top to Down） 流向。\n\n```mermaid\ngraph LR\n    A[開始] --> B{判斷條件}\n    B -->|是| C[處理1]\n    B -->|否| D[處理2]\n    C --> E[結束]\n    D --> E\n```\n",
    "flowchart-basic-td": "## 流程圖 - 基本決策 (上下)\n\n```mermaid\nflowchart TD\n    A[開始] --> B{判斷條件}\n    B -->|是| C[處理1]\n    B -->|否| D[處理2]\n    C --> E[結束]\n    D --> E\n```\n",
    "flowchart-basic-lr": "## 流程圖 - 基本決策 (左右)\n\n```mermaid\nflowchart LR\n    A[開始] --> B{判斷條件}\n    B -->|是| C[處理1]\n    B -->|否| D[處理2]\n    C --> E[結束]\n    D --> E\n```\n",
    "flowchart-login": "## 流程圖 - 登入驗證\n\n```mermaid\nflowchart TD\n    A[使用者登入] --> B{驗證帳密}\n    B -->|成功| C[載入首頁]\n    B -->|失敗| D{重試次數 < 3}\n    D -->|是| A\n    D -->|否| E[鎖定帳號]\n    C --> F[結束]\n    E --> F\n```\n",
    "flowchart-subgraph": "## 流程圖 - 子圖分組 (subgraph)\n\n```mermaid\nflowchart TD\n    subgraph Frontend\n        A[使用者介面]\n        B[表單驗證]\n    end\n    subgraph Backend\n        C[API 處理]\n        D[資料庫查詢]\n    end\n    A --> B --> C --> D\n```\n",
    "flowchart-loadbalance": "## 流程圖 - 負載均衡架構\n\n```mermaid\nflowchart LR\n    A[Client] --> B[Load Balancer]\n    B --> C[Server 1]\n    B --> D[Server 2]\n    B --> E[Server 3]\n    C --> F[(Database)]\n    D --> F\n    E --> F\n```\n",
    "flowchart-agent": "## 流程圖 - Agent 任務重試\n\n```mermaid\nflowchart TD\n    A[開始任務] --> B[執行 Agent]\n    B --> C{執行成功?}\n    C -->|是| D[提交結果]\n    C -->|否| E{重試次數}\n    E -->|< 3| B\n    E -->|>= 3| F[回報失敗]\n    D --> G[結束]\n    F --> G\n```\n",
    "sequence": "## 2. 序列圖 (Sequence Diagram)\n- 用於顯示訊息在不同角色（Actors）間的傳遞順序。\n- 可以設定箭頭方向、訊息文字，適合呈現系統互動流程。\n\n```mermaid\nsequenceDiagram\n    Alice->>Bob: 你好 Bob\n    Bob-->>Alice: 你好 Alice\n    Alice->>Charlie: 問候 Charlie\n```\n",
    "sequence-basic": "## 序列圖 - 基本範例\n\n```mermaid\nsequenceDiagram\n    Alice->>Bob: 你好 Bob\n    Bob-->>Alice: 你好 Alice\n    Alice->>Charlie: 問候 Charlie\n```\n",
    "sequence-multi": "## 序列圖 - 多角色流程\n\n```mermaid\nsequenceDiagram\n    participant Developer\n    participant Orchestrator\n    participant AIAgent\n    participant Repo\n    participant ReviewBot\n\n    Developer->>Orchestrator: Submit Task\n    Orchestrator->>AIAgent: Execute Coding Task\n    AIAgent->>Repo: Clone Repo\n    AIAgent->>Repo: Commit Code\n    Repo-->>AIAgent: Commit Success\n    AIAgent->>ReviewBot: Request Code Review\n    ReviewBot-->>Orchestrator: Review Result\n    Orchestrator-->>Developer: Task Completed\n```\n",
    "sequence-loop": "## 序列圖 - 迴圈 (loop)\n\n```mermaid\nsequenceDiagram\n    participant Client\n    participant Server\n\n    loop Retry 3 times\n        Client->>Server: Request Data\n        Server-->>Client: Response\n    end\n```\n",
    "sequence-activate": "## 序列圖 - 啟用/停用 (activate)\n\n```mermaid\nsequenceDiagram\n    participant User\n    participant API\n    participant DB\n\n    User->>API: request\n    activate API\n\n    API->>DB: query\n    activate DB\n\n    DB-->>API: result\n    deactivate DB\n\n    API-->>User: response\n    deactivate API\n```\n",
    "sequence-autonumber": "## 序列圖 - 自動編號 (autonumber)\n\n```mermaid\nsequenceDiagram\n    autonumber\n\n    participant User\n    participant Frontend\n    participant API\n    participant Service\n    participant DB\n\n    User->>Frontend: Click Submit\n    Frontend->>API: POST /task\n    API->>Service: createTask()\n    Service->>DB: insert task\n    DB-->>Service: OK\n    Service-->>API: success\n    API-->>Frontend: 200 OK\n    Frontend-->>User: Task Created\n```\n",
    "sequence-note": "## 序列圖 - 備註 (note)\n\n```mermaid\nsequenceDiagram\n    participant User\n    participant API\n\n    User->>API: login\n\n    Note right of API: validate user token\n\n    API-->>User: result\n```\n",
    "class": "## 4. 類別圖 (Class Diagram)\n- 用於描述物件導向程式設計中的類與關係。\n- 可以表示類之間的繼承、關聯與接口。\n\n```mermaid\nclassDiagram\n    class Car{\n        +String color\n        +void drive()\n    }\n    class Engine{\n        +void start()\n    }\n    Car --> Engine\n```\n",
    "class-basic": "## 類別圖 - 基本\n\n```mermaid\nclassDiagram\n    class Car{\n        +String color\n        +void drive()\n    }\n    class Engine{\n        +void start()\n    }\n    Car --> Engine\n```\n",
    "class-relation": "## 類別圖 - 關聯關係\n\n```mermaid\nclassDiagram\n    class User {\n        +int id\n        +string name\n        +string email\n        +login()\n        +logout()\n    }\n\n    class Order {\n        +int id\n        +date orderDate\n        +calculateTotal()\n    }\n\n    User --> Order : places\n```\n",
    "class-association": "## 類別圖 - 雙類關聯\n\n```mermaid\nclassDiagram\n\nclass Account {\n    +String username\n    +String password\n    +login()\n    +logout()\n}\n\nclass Profile {\n    +String name\n    +String address\n    +updateProfile()\n}\n\nAccount --> Profile : has\n```\n",
    "class-inheritance": "## 類別圖 - 繼承 (inheritance)\n\n```mermaid\nclassDiagram\n\nclass Animal {\n    +eat()\n    +sleep()\n}\n\nclass Dog {\n    +bark()\n}\n\nclass Cat {\n    +meow()\n}\n\nAnimal <|-- Dog\nAnimal <|-- Cat\n```\n",
    "class-interface": "## 類別圖 - 介面實作 (interface)\n\n```mermaid\nclassDiagram\n\nclass Payment {\n    <<interface>>\n    +pay()\n}\n\nclass CreditCardPayment {\n    +pay()\n}\n\nclass PayPalPayment {\n    +pay()\n}\n\nPayment <|.. CreditCardPayment\nPayment <|.. PayPalPayment\n```\n",
    "class-composition": "## 類別圖 - 組合/聚合 (composition/aggregation)\n\n```mermaid\nclassDiagram\n\nclass Car {\n    +start()\n}\n\nclass Engine {\n    +run()\n}\n\nclass Wheel {\n    +rotate()\n}\n\nCar *-- Engine\nCar o-- Wheel\n```\n",
    "class-agent": "## 類別圖 - Agent 系統\n\n```mermaid\nclassDiagram\n\nclass Agent {\n    +id\n    +name\n    +executeTask()\n}\n\nclass Task {\n    +id\n    +title\n    +status\n    +run()\n}\n\nclass Review {\n    +reviewer\n    +result\n}\n\nclass Repository {\n    +cloneRepo()\n    +commitCode()\n}\n\nAgent --> Task : executes\nTask --> Review : reviewed_by\nAgent --> Repository : uses\n```\n",
    "class-namespace": "## 類別圖 - 命名空間 (namespace)\n\n```mermaid\nclassDiagram\n\nnamespace Auth {\n    class User {\n        +login()\n        +logout()\n    }\n\n    class Token {\n        +generate()\n        +validate()\n    }\n}\n\nnamespace Order {\n    class OrderService {\n        +createOrder()\n        +cancelOrder()\n    }\n}\n\nUser --> Token\nUser --> OrderService\n```\n",
    "state": "## 5. 狀態圖 (State Diagram)\n- 用於展示系統或物件不同狀態及其轉換。\n- 適合表達事件驅動、工作流程狀態轉換。\n\n```mermaid\nstateDiagram-v2\n    [*] --> Idle\n    Idle --> Running : 啟動\n    Running --> Idle : 停止\n```\n",
    "state-basic": "## 狀態圖 - 基本流程\n\n```mermaid\nstateDiagram-v2\n    [*] --> Idle\n    Idle --> Processing\n    Processing --> Completed\n    Completed --> [*]\n```\n",
    "state-login": "## 狀態圖 - 登入/登出\n\n```mermaid\nstateDiagram-v2\n    [*] --> LoggedOut\n\n    LoggedOut --> LoggedIn : login()\n    LoggedIn --> LoggedOut : logout()\n```\n",
    "state-order": "## 狀態圖 - 訂單流程\n\n```mermaid\nstateDiagram-v2\n    [*] --> Created\n\n    Created --> Paid : payment\n    Paid --> Shipped : ship\n    Shipped --> Delivered : deliver\n\n    Paid --> Cancelled : cancel\n    Created --> Cancelled : cancel\n```\n",
    "state-composite": "## 狀態圖 - 複合狀態 (composite)\n\n```mermaid\nstateDiagram-v2\n\nstate OrderProcess {\n    [*] --> Created\n    Created --> Paid\n    Paid --> Shipped\n    Shipped --> Delivered\n}\n\n[*] --> OrderProcess\nOrderProcess --> [*]\n```\n",
    "state-agent": "## 狀態圖 - Agent 任務流程\n\n```mermaid\nstateDiagram-v2\n\n[*] --> TaskSubmitted\n\nTaskSubmitted --> AgentProcessing\nAgentProcessing --> CodeGenerated\nCodeGenerated --> Reviewing\nReviewing --> Approved\nReviewing --> Rejected\n\nRejected --> AgentProcessing\nApproved --> Deployment\n\nDeployment --> Completed\nCompleted --> [*]\n```\n",
    "state-fork": "## 狀態圖 - 並行分叉 (fork/join)\n\n```mermaid\nstateDiagram-v2\n\n[*] --> Fork\n\nFork --> ServiceA\nFork --> ServiceB\n\nServiceA --> Join\nServiceB --> Join\n\nJoin --> Completed\nCompleted --> [*]\n```\n",
    "state-retry": "## 狀態圖 - 重試機制\n\n```mermaid\nstateDiagram-v2\n\n[*] --> Pending\n\nPending --> Running : start task\nRunning --> Success : finish\nRunning --> Failed : error\nFailed --> Pending : retry\n```\n",
    "state-full": "## 狀態圖 - 完整生命週期\n\n```mermaid\nstateDiagram-v2\n\n[*] --> Init\n\nInit --> Loading : start()\nLoading --> Ready : success\nLoading --> Error : fail\n\nReady --> Processing : runTask\nProcessing --> Completed : done\nProcessing --> Error : exception\n\nError --> Loading : retry\nCompleted --> [*]\n```\n",
    "er": "## 資料關聯圖\n```mermaid\nerDiagram\n    USER {\n        int id PK\n        string name\n        string email\n        datetime created_at\n    }\n\n    ORDER {\n        int id PK\n        int user_id FK\n        decimal total_amount\n        datetime order_date\n    }\n\n    PRODUCT {\n        int id PK\n        string name\n        decimal price\n    }\n\n    ORDER_ITEM {\n        int id PK\n        int order_id FK\n        int product_id FK\n        int quantity\n    }\n\n    USER ||--o{ ORDER : places\n    ORDER ||--o{ ORDER_ITEM : contains\n    PRODUCT ||--o{ ORDER_ITEM : included_in\n```\n",
    "er-basic": "## ER 圖 - 基本關聯\n\n```mermaid\nerDiagram\n    USER {\n        int id PK\n        string name\n        string email\n    }\n\n    POST {\n        int id PK\n        int user_id FK\n        string title\n        string content\n    }\n\n    USER ||--o{ POST : writes\n```\n",
    "er-ecommerce": "## ER 圖 - 電商系統\n\n```mermaid\nerDiagram\n    USER {\n        int id PK\n        string name\n        string email\n        datetime created_at\n    }\n\n    ORDER {\n        int id PK\n        int user_id FK\n        decimal total_amount\n        datetime order_date\n    }\n\n    PRODUCT {\n        int id PK\n        string name\n        decimal price\n    }\n\n    ORDER_ITEM {\n        int id PK\n        int order_id FK\n        int product_id FK\n        int quantity\n    }\n\n    USER ||--o{ ORDER : places\n    ORDER ||--o{ ORDER_ITEM : contains\n    PRODUCT ||--o{ ORDER_ITEM : included_in\n```\n",
    "er-auth": "## ER 圖 - 帳號權限\n\n```mermaid\nerDiagram\n    USER {\n        int id PK\n        string username\n        string password_hash\n        string email\n    }\n\n    ROLE {\n        int id PK\n        string name\n    }\n\n    PERMISSION {\n        int id PK\n        string action\n        string resource\n    }\n\n    USER_ROLE {\n        int user_id FK\n        int role_id FK\n    }\n\n    ROLE_PERMISSION {\n        int role_id FK\n        int permission_id FK\n    }\n\n    USER ||--o{ USER_ROLE : has\n    ROLE ||--o{ USER_ROLE : assigned_to\n    ROLE ||--o{ ROLE_PERMISSION : has\n    PERMISSION ||--o{ ROLE_PERMISSION : granted_by\n```\n",
    "er-blog": "## ER 圖 - 部落格系統\n\n```mermaid\nerDiagram\n    USER {\n        int id PK\n        string name\n        string email\n    }\n\n    POST {\n        int id PK\n        int author_id FK\n        string title\n        datetime published_at\n    }\n\n    COMMENT {\n        int id PK\n        int post_id FK\n        int user_id FK\n        string content\n    }\n\n    TAG {\n        int id PK\n        string name\n    }\n\n    POST_TAG {\n        int post_id FK\n        int tag_id FK\n    }\n\n    USER ||--o{ POST : writes\n    POST ||--o{ COMMENT : has\n    USER ||--o{ COMMENT : writes\n    POST ||--o{ POST_TAG : tagged_with\n    TAG ||--o{ POST_TAG : applied_to\n```\n",
    "er-task": "## ER 圖 - 任務管理\n\n```mermaid\nerDiagram\n    USER {\n        int id PK\n        string name\n        string email\n    }\n\n    PROJECT {\n        int id PK\n        string title\n        string status\n    }\n\n    TASK {\n        int id PK\n        int project_id FK\n        int assignee_id FK\n        string title\n        string status\n        datetime due_date\n    }\n\n    USER ||--o{ TASK : assigned_to\n    PROJECT ||--o{ TASK : contains\n```\n",
    "er-agent": "## ER 圖 - AI Agent 系統\n\n```mermaid\nerDiagram\n    AGENT {\n        int id PK\n        string name\n        string type\n        string status\n    }\n\n    TASK {\n        int id PK\n        int agent_id FK\n        string title\n        string status\n        datetime created_at\n    }\n\n    RESULT {\n        int id PK\n        int task_id FK\n        string output\n        string review_status\n        datetime reviewed_at\n    }\n\n    LOG {\n        int id PK\n        int task_id FK\n        string level\n        string message\n        datetime logged_at\n    }\n\n    AGENT ||--o{ TASK : executes\n    TASK ||--|| RESULT : produces\n    TASK ||--o{ LOG : generates\n```\n",
    "usecase": "## 7. 用例圖 (Use Case Diagram)\n- 用於描述系統功能與使用者互動。\n- 常用於需求分析與系統設計。\n\n```mermaid\nflowchart LR\n    A((使用者))\n    B([登入])\n    C([查詢訂單])\n    A --> B\n    A --> C\n```\n",
    "usecase-multi": "## 用例圖 - 多角色\n\n```mermaid\nflowchart LR\n\nUser([User])\nAdmin([Admin])\n\nLogin((Login))\nSubmit((Submit Task))\nReview((Review Task))\n\nUser --> Login\nUser --> Submit\nAdmin --> Review\n\nclassDef actor fill:#f9f,stroke:#333\nclassDef usecase fill:#bbf,stroke:#333\n\nclass User,Admin actor\nclass Login,Submit,Review usecase\n```\n",
    "usecase-include": "## 用例圖 - include / extend\n\n```mermaid\nflowchart LR\n\nUser([User])\n\nLogin((Login))\nAuth((Authenticate))\nReset((Reset Password))\n\nUser --> Login\n\nLogin -.include.-> Auth\nLogin -.extend.-> Reset\n```\n",
    "usecase-system": "## 用例圖 - 系統邊界 (subgraph)\n\n```mermaid\nflowchart LR\n\nUser([User])\nAdmin([Admin])\n\nsubgraph System[\"Task Management System\"]\n\nUC1((Login))\nUC2((Submit Task))\nUC3((Review Task))\nUC4((Approve Task))\n\nend\n\nUser --> UC1\nUser --> UC2\n\nAdmin --> UC1\nAdmin --> UC3\nAdmin --> UC4\n```\n",
    "usecase-native": "## 用例圖 - usecaseDiagram 語法\n\n```mermaid\nusecaseDiagram\n    Actor 使用者\n    使用者 --> (登入)\n    使用者 --> (查詢訂單)\n```\n",
    "gantt-basic": "## 甘特圖範例一：基本甘特圖\n- 用於專案時程規劃與進度追蹤。\n\n```mermaid\ngantt\n    title 專案開發時程\n    dateFormat  YYYY-MM-DD\n    axisFormat  %m/%d\n\n    section 規劃階段\n    需求訪談           :a1, 2026-03-01, 3d\n    系統設計           :after a1, 5d\n\n    section 開發階段\n    前端開發           :2026-03-10, 7d\n    後端開發           :2026-03-10, 10d\n\n    section 測試與上線\n    整合測試           :2026-03-20, 5d\n    正式上線           :milestone, 2026-03-26, 1d\n```\n",
    "gantt-dependency": "## 甘特圖範例二：含依賴關係 + 里程碑\n- 使用 after 任務ID 建立任務依賴，milestone 標示關鍵節點。\n\n```mermaid\ngantt\n    title AI Agent 專案計畫\n    dateFormat YYYY-MM-DD\n\n    section 分析\n    商業需求確認       :done, des1, 2026-03-01, 4d\n    技術架構設計       :active, des2, after des1, 5d\n\n    section 開發\n    MVP 開發           :dev1, after des2, 10d\n    API 串接           :dev2, after dev1, 5d\n\n    section 上線\n    UAT 測試           :test1, after dev2, 5d\n    上線               :milestone, after test1, 0d\n```\n\n| 語法 | 說明 |\n|------|------|\n| `section` | 分組 |\n| `dateFormat` | 日期格式 |\n| `after 任務ID` | 依賴前一任務 |\n| `3d` | 持續 3 天 |\n| `done` | 已完成 |\n| `active` | 進行中 |\n| `milestone` | 里程碑 |\n| `excludes weekends` | 排除週末 |\n",
    "gantt-sprint": "## 甘特圖範例三：軟體開發專案（含狀態）\n- 適合 Sprint 開發節奏，含 done/active 狀態。\n\n```mermaid\ngantt\n    title VIBE CODING 開發節奏\n    dateFormat  YYYY-MM-DD\n\n    section Sprint 1\n    規格撰寫           :done, s1a, 2026-03-01, 3d\n    UI 設計            :done, s1b, after s1a, 3d\n    API 設計           :active, s1c, after s1a, 4d\n\n    section Sprint 2\n    功能開發           :s2a, after s1c, 7d\n    單元測試           :s2b, after s2a, 3d\n\n    section Release\n    整合測試           :s3a, after s2b, 5d\n    發布               :milestone, after s3a, 0d\n```\n\n**Mermaid Gantt 常用語法速查：**\n- `gantt` / `title` / `dateFormat` / `axisFormat` / `excludes weekends`\n- `section 區塊名稱`\n- `任務名稱 :狀態, 任務ID, 開始日, 持續時間`\n- `任務名稱 :after 任務ID, 持續時間`\n- `任務名稱 :milestone, 日期, 0d`\n",
    "gantt-project": "## 甘特圖 - 專案開發時程\n\n```mermaid\ngantt\n    title Project Development Timeline\n    dateFormat  YYYY-MM-DD\n\n    section Planning\n    Requirement Analysis :a1, 2026-03-01, 3d\n    System Design        :a2, after a1, 4d\n\n    section Development\n    Backend Development  :b1, 2026-03-08, 7d\n    Frontend Development :b2, after b1, 5d\n\n    section Testing\n    Integration Test     :c1, after b2, 3d\n    Deployment           :c2, after c1, 2d\n```\n",
    "gantt-release": "## 甘特圖 - 產品發布計畫\n\n```mermaid\ngantt\n    title Product Release Plan\n    dateFormat YYYY-MM-DD\n\n    section Phase 1\n    Market Research   :done, 2026-03-01, 5d\n    Product Design    :active, 2026-03-06, 6d\n\n    section Phase 2\n    Development       :2026-03-12, 10d\n    Testing           :2026-03-22, 5d\n\n    section Launch\n    Release           :2026-03-27, 2d\n```\n",
    "gantt-software": "## 甘特圖 - 軟體專案\n\n```mermaid\ngantt\n    title Software Project\n    dateFormat  YYYY-MM-DD\n\n    section Design\n    Architecture Design :a1, 2026-03-01, 4d\n    DB Design           :a2, after a1, 3d\n\n    section Coding\n    API Development     :b1, after a2, 6d\n    UI Development      :b2, after a2, 5d\n\n    section QA\n    System Testing      :c1, after b1, 4d\n```\n",
    "gantt-agent": "## 甘特圖 - AI Agent Coding System\n\n```mermaid\ngantt\n    title AI Agent Coding System\n    dateFormat YYYY-MM-DD\n\n    section Architecture\n    Define AI Agent Roles      :a1, 2026-03-01, 3d\n    Orchestrator Design        :a2, after a1, 4d\n\n    section Development\n    Agent Task Engine          :b1, 2026-03-08, 6d\n    Repo Integration           :b2, after b1, 3d\n    Code Generation Module     :b3, after b2, 4d\n\n    section Validation\n    Auto Code Review           :c1, after b3, 3d\n    Deployment Pipeline        :c2, after c1, 2d\n```\n",
    "gantt-milestone": "## 甘特圖 - 含里程碑\n\n```mermaid\ngantt\n    title Product Roadmap\n    dateFormat YYYY-MM-DD\n\n    section Planning\n    Requirement Analysis :a1, 2026-03-01, 5d\n\n    section Development\n    Core Development     :b1, 2026-03-06, 10d\n\n    section Milestone\n    Beta Release         :milestone, 2026-03-16, 0d\n```\n",
    "gantt-excludes": "## 甘特圖 - 排除週末\n\n```mermaid\ngantt\n    title Work Schedule\n    dateFormat YYYY-MM-DD\n    excludes weekends\n\n    section Tasks\n    Task A :2026-03-01, 5d\n    Task B :after Task A, 4d\n```\n",
    "flowchart-microservice": "## 微服務架構圖 (Microservice Architecture)\n- 用於描述系統各服務之間的呼叫關係與資料庫對應。\n\n```mermaid\nflowchart LR\n    Client --> Gateway\n    Gateway --> UserService\n    Gateway --> OrderService\n    Gateway --> PaymentService\n    UserService --> DB1[(UserDB)]\n    OrderService --> DB2[(OrderDB)]\n    PaymentService --> DB3[(PaymentDB)]\n```\n",
    "journey": "## 使用者旅程圖 - 購物流程\n- 用於描述使用者與系統互動的完整流程與體驗。\n- 每個步驟標示滿意度分數（1–5）與對應角色。\n\n```mermaid\njourney\n    title 使用者購物流程\n    section 瀏覽\n        首頁: 5: User\n        商品頁: 4: User\n    section 購買\n        加入購物車: 3: User\n        付款: 2: User\n```\n",
    "journey-app": "## 使用者旅程圖 - App 新用戶體驗\n- 描述新用戶從下載到完成首次任務的完整旅程。\n\n```mermaid\njourney\n    title App 新用戶體驗\n    section 下載與安裝\n        App Store 搜尋: 5: User\n        下載安裝: 4: User\n    section 註冊\n        填寫資料: 3: User\n        Email 驗證: 2: User\n    section 首次使用\n        導覽教學: 4: User\n        完成首次任務: 5: User\n```\n",
    "journey-saas": "## 使用者旅程圖 - SaaS 訂閱旅程\n- 描述用戶從試用到付費訂閱的關鍵觸點與滿意度。\n\n```mermaid\njourney\n    title SaaS 訂閱旅程\n    section 探索\n        看到廣告: 3: User\n        訪問官網: 4: User\n        閱讀功能介紹: 4: User\n    section 試用\n        免費試用申請: 5: User\n        功能體驗: 4: User\n        聯絡客服: 3: User\n    section 訂閱\n        比較方案: 3: User\n        填寫付款資料: 2: User\n        訂閱成功: 5: User\n```\n",
    "journey-agent": "## 使用者旅程圖 - AI Agent 互動旅程\n- 描述使用者與 AI Agent 協作完成任務的互動流程。\n\n```mermaid\njourney\n    title AI Agent 互動旅程\n    section 任務發起\n        提出需求: 5: User\n        Agent 解析意圖: 4: Agent\n    section 執行\n        Agent 規劃步驟: 5: Agent\n        調用工具: 4: Agent\n        回報進度: 4: Agent\n    section 交付\n        提交結果: 5: Agent\n        用戶驗收: 4: User\n        回饋調整: 3: User\n```\n",
    "timeline": "## 時間軸 - 公司發展\n- 用於呈現事件的時間順序與發展歷程。\n- 每一行格式為「年份/時間 : 事件描述」。\n\n```mermaid\ntimeline\n    title 公司發展\n    2022 : 公司成立\n    2023 : 產品發布\n    2024 : 融資\n    2025 : 全球市場\n```\n",
    "timeline-product": "## 時間軸 - 產品版本發布\n- 用於展示產品各版本發布與關鍵功能推出時間點。\n\n```mermaid\ntimeline\n    title 產品版本發布\n    2024 Q1 : MVP 上線\n            : 基礎功能完成\n    2024 Q2 : v1.1 發布\n            : 用戶反饋優化\n    2024 Q3 : v2.0 重大更新\n            : AI 功能整合\n    2025 Q1 : v3.0 企業版\n            : 多租戶支援\n```\n",
    "timeline-tech": "## 時間軸 - 技術架構演進\n- 用於展示技術棧升級與架構演進的時間脈絡。\n\n```mermaid\ntimeline\n    title 技術架構演進\n    2020 : 單體應用\n         : PHP + MySQL\n    2021 : 服務拆分\n         : Node.js Microservices\n    2022 : 容器化\n         : Docker + Kubernetes\n    2023 : 雲原生\n         : AWS + Terraform\n    2024 : AI 整合\n         : LLM + Vector DB\n```\n",
    "timeline-project": "## 時間軸 - 專案開發進程\n- 用於呈現專案各階段完成的重要事項。\n\n```mermaid\ntimeline\n    title 系統開發進程\n    三月 : 需求分析完成\n         : 技術選型確認\n    四月 : 資料庫設計\n         : API 規格定義\n    五月 : 前端開發\n         : 後端開發\n    六月 : 整合測試\n         : UAT 驗收\n    七月 : 正式上線\n         : 維運交接\n```\n",
    "requirement": "## 需求圖 - 基本需求\n- 用於描述系統需求、風險等級與驗證方式。\n- risk 可填：low / medium / high；verifymethod 可填：analysis / inspection / test / demonstration。\n\n```mermaid\nrequirementDiagram\n    requirement login {\n        id: 1\n        text: User must login\n        risk: high\n        verifymethod: test\n    }\n```\n",
    "requirement-system": "## 需求圖 - 系統功能需求\n- 描述系統核心功能需求、風險與驗證方式。\n\n```mermaid\nrequirementDiagram\n    requirement sys_login {\n        id: 1\n        text: 使用者可使用帳號密碼登入\n        risk: high\n        verifymethod: test\n    }\n    requirement sys_search {\n        id: 2\n        text: 支援全文搜尋\n        risk: medium\n        verifymethod: inspection\n    }\n    requirement sys_export {\n        id: 3\n        text: 可匯出 PDF 報告\n        risk: low\n        verifymethod: demonstration\n    }\n    element frontend {\n        type: webapp\n    }\n    frontend - satisfies -> sys_login\n    frontend - satisfies -> sys_search\n    frontend - satisfies -> sys_export\n```\n",
    "requirement-security": "## 需求圖 - 安全性需求\n- 用於定義系統安全合規需求與驗證方法。\n\n```mermaid\nrequirementDiagram\n    requirement sec_auth {\n        id: SEC-01\n        text: 支援雙因素驗證 (2FA)\n        risk: high\n        verifymethod: test\n    }\n    requirement sec_encrypt {\n        id: SEC-02\n        text: 資料傳輸須使用 TLS 1.3\n        risk: high\n        verifymethod: analysis\n    }\n    requirement sec_audit {\n        id: SEC-03\n        text: 所有操作須記錄審計日誌\n        risk: medium\n        verifymethod: inspection\n    }\n    element authService {\n        type: service\n        docref: auth-spec-v2\n    }\n    authService - satisfies -> sec_auth\n    authService - satisfies -> sec_encrypt\n    authService - satisfies -> sec_audit\n```\n",
    "mindmap-claude-guide": "## 心智圖 - Claude 提示指南（Mermaid mindmap）\n- 縮排表示階層；`root((文字))` 為中央圓形根節點。\n\n```mermaid\nmindmap\n  root((Claude 提示指南))\n    核心原則\n      清楚具體\n        說明任務目標\n        提供背景細節\n        拆解複雜步驟\n      舉例說明\n        提供輸出範例\n        指定格式與風格\n      鼓勵思考\n        要求一步步思考\n        解釋推理過程\n      角色扮演\n        賦予特定身份\n        探索多元觀點\n    任務專屬技巧\n      內容創作\n        指定目標受眾\n        定義語氣風格\n        規定輸出結構\n      文件摘要與問答\n        明確摘要範圍\n        引用具體章節\n        使用文件名稱\n      資料分析\n        指定呈現格式\n        要求數據驅動建議\n        徵詢視覺化方案\n      腦力激盪\n        設定量化目標\n        要求比較表格\n    優化與除錯\n      減少幻覺\n        允許承認不確定性\n      迭代精煉\n        提供具體回饋\n        針對性調整\n      環境管理\n        包含所有必要上下文\n        分段執行大型任務\n```\n",
    "mindmap-simple": "## 心智圖 - 簡易三層結構\n\n```mermaid\nmindmap\n  root((主題))\n    分支 A\n      子項 A1\n      子項 A2\n    分支 B\n      子項 B1\n```\n",
    "mindmap-project": "## 心智圖 - 專案規劃\n\n```mermaid\nmindmap\n  root((產品路線圖))\n    規劃\n      需求訪談\n      技術選型\n    開發\n      前端\n      後端\n      API 整合\n    品質\n      單元測試\n      UAT\n    上線\n      部署\n      監控\n```\n",
    "mindmap-meeting": "## 心智圖 - 會議／腦力激盪\n\n```mermaid\nmindmap\n  root((本週站會))\n    進度\n      已完成\n      進行中\n    阻礙\n      依賴項目\n      資源缺口\n    下一步\n      負責人\n      截止日\n```\n",
    "mindmap-tech-stack": "## 心智圖 - 技術棧（參考 Mermaid Live Editor 風格）\n\n```mermaid\nmindmap\n  root((系統架構))\n    前端\n      React\n      TypeScript\n    後端\n      ASP\n      REST API\n    資料\n      SQL Server\n      快取\n    維運\n      IIS\n      日誌與監控\n```\n",
};
var urdMdIconCategories = [
    { tab:"😀", name:"表情", icons:["😀","😊","😃","🙂","😎","🤔","😅","😆","😁","😄","🥳","😇","🤩","😍","🥰","😋","😛","😜","🤗","😐","😑","😶","😏","😒","🙄","😮","😲","😳","😴","🤭"] },
    { tab:"👋", name:"手勢", icons:["👍","👎","👏","🙏","✋","💪","🤝","👀","👋","🤜","🤛","🤞","✌️","🤙","👆","👇","👈","👉","☝️","🤚","🖐️","🖖","👌","🤌","🤏","🫶","🤲","💅","🫵","🤘"] },
    { tab:"✅", name:"狀態", icons:["✅","❌","⚠️","❗","❓","ℹ️","🔴","🟡","🟢","🔵","✓","✗","→","←","↑","↓","↔️","⬆️","⬇️","➡️","⭕","🚫","⛔","🔔","🔕","💯","🆕","🆗","🆙","🆒"] },
    { tab:"📝", name:"辦公", icons:["📝","📋","📅","📧","📎","📁","📂","📌","📍","🗂","🗒","🗓","📊","📈","📉","💬","💡","🏷️","⏰","📦","🔗","📤","📥","📨","📩","📫","📪","🗑","🖊️","📓"] },
    { tab:"💻", name:"科技", icons:["💻","🖥️","🖨️","⌨️","🖱️","📱","📲","🔍","🔎","🛠","🔧","🔨","⚙️","🔩","🔌","🔋","💾","💿","📀","🌐","🚀","🛡️","🔐","🔒","🔓","🔑","📡","🔬","🔭","🧩"] },
    { tab:"🎉", name:"慶祝", icons:["🎉","🎊","🏆","🥇","🎯","🌟","⭐","💫","✨","🌈","🔥","⚡","💥","🎁","🎀","🌺","🌻","🌹","🌸","🍀","🎵","🎶","🎸","🎹","🎺","🎻","🎮","🎲","🎭","🎨"] }
];
function urdMdInsertIcon(ta, icon) {
    if (!ta || !icon) return;
    urdMdInsert(ta, icon + " ", "", "");
}
function buildIconPickerContent() {
    var h = '<div class="urd-md-icon-tabs">';
    for (var c = 0; c < urdMdIconCategories.length; c++) {
        var cat = urdMdIconCategories[c];
        h += '<button type="button" class="urd-md-icon-tab' + (c === 0 ? ' urd-tab-active' : '') + '" data-md-act="icon-tab" data-tab-idx="' + c + '" title="' + cat.name + '">' + cat.tab + '</button>';
    }
    h += '</div>';
    for (var c = 0; c < urdMdIconCategories.length; c++) {
        var cat = urdMdIconCategories[c];
        h += '<div class="urd-md-icon-panel' + (c === 0 ? ' urd-tab-active' : '') + '" data-panel-idx="' + c + '">';
        for (var i = 0; i < cat.icons.length; i++) {
            h += '<div class="urd-md-icon-item" data-md-act="icon-pick" data-icon="' + cat.icons[i] + '">' + cat.icons[i] + '</div>';
        }
        h += '</div>';
    }
    return h;
}
function buildIconPickerHtml() {
    return '<div class="urd-md-icon-picker-popup" style="display:none;">' + buildIconPickerContent() + '</div>';
}
function urdMdInsertUmlTemplate(ta, key) {
    if (!ta || !urdUmlTemplates[key]) return;
    var block = urdUmlTemplates[key];
    ta.focus();
    var start = ta.selectionStart || 0;
    var end = ta.selectionEnd || 0;
    var text = (start > 0 && ta.value.charAt(start - 1) !== "\n" ? "\n\n" : "\n") + block + "\n";
    ta.value = ta.value.substring(0, start) + text + ta.value.substring(end);
    var pos = start + text.length;
    ta.setSelectionRange(pos, pos);
}
function urdMdSetLayout(input, preview, mode) {
    if (!input || !preview) return;
    if (mode === "left-only") {
        input.style.display = "block";
        input.style.flex = "1 1 100%";
        input.style.width = "100%";
        input.style.minHeight = "0";
        input.style.borderRight = "0";
        preview.style.display = "none";
        return;
    }
    if (mode === "right-only") {
        input.style.display = "none";
        preview.style.display = "block";
        preview.style.flex = "1 1 100%";
        preview.style.width = "100%";
        preview.style.minHeight = "0";
        return;
    }
    // both
    input.style.display = "block";
    input.style.borderRight = "1px solid #d9d9d9";
    input.style.flex = "1 1 0";
    input.style.width = "auto";
    input.style.minHeight = "0";
    preview.style.display = "block";
    preview.style.flex = "1 1 0";
    preview.style.width = "auto";
    preview.style.minHeight = "0";
}
function hideNativeMermaidErrorBlocks(scope) {
    var root = scope || document;
    try {
        var svgs = root.querySelectorAll("svg");
        for (var i = 0; i < svgs.length; i++) {
            var svg = svgs[i];
            if (svg.querySelector(".error-icon")) {
                var box = svg.closest(".mermaid, .urd-md-mermaid, .urd-md-mermaid-wrap");
                if (!box) box = svg.parentNode;
                if (box) {
                    box.style.display = "none";
                    box.setAttribute("data-mermaid-hidden-error", "1");
                }
            }
        }
    } catch (e) {}
}
function urdMermaidSvgToPngBlob(svg, scale, cb) {
    if (!svg || !cb) return;
    try {
        var w = svg.clientWidth || parseInt(svg.getAttribute("width"), 10) || 800;
        var h = svg.clientHeight || parseInt(svg.getAttribute("height"), 10) || 600;
        var vb = svg.getAttribute("viewBox");
        if ((!w || !h) && vb) { var p = vb.split(/\s+/); if (p.length >= 4) { w = parseInt(p[2], 10) || 800; h = parseInt(p[3], 10) || 600; } }
        w = w || 800; h = h || 600;
        var svgClone = svg.cloneNode(true);
        svgClone.setAttribute("width", w);
        svgClone.setAttribute("height", h);
        var svgData = new XMLSerializer().serializeToString(svgClone);
        var img = new Image();
        var canvas = document.createElement("canvas");
        scale = scale || 2;
        canvas.width = w * scale;
        canvas.height = h * scale;
        img.onload = function() {
            var ctx = canvas.getContext("2d");
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function(blob) { cb(blob); }, "image/png", 1);
        };
        img.onerror = function() { cb(null); };
        img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
    } catch (e) { cb(null); }
}
function urdMermaidZoomHostUrdMd(wrap) {
    if (!wrap || !wrap.querySelector) return wrap;
    var z = wrap.querySelector(".urd-md-mermaid-zoom");
    return z || wrap;
}
function urdMermaidSyncUrdMdWrapLayoutHeight(wrap) {
    if (!wrap || !wrap.classList || !wrap.classList.contains("urd-md-mermaid-wrap")) return;
    var zoomHost = urdMermaidZoomHostUrdMd(wrap);
    if (!zoomHost) return;
    var scale = parseFloat(zoomHost.getAttribute("data-zoom") || "1");
    if (isNaN(scale) || scale <= 0) scale = 1;
    if (scale === 1) {
        wrap.style.minHeight = "";
        wrap.style.minWidth = "";
        return;
    }
    zoomHost.style.transformOrigin = "top center";
    zoomHost.style.transform = "none";
    var h0 = zoomHost.offsetHeight;
    if (!h0 || h0 < 2) h0 = zoomHost.scrollHeight;
    var w0 = zoomHost.offsetWidth;
    if (!w0 || w0 < 2) w0 = zoomHost.scrollWidth;
    zoomHost.style.transform = "scale(" + scale + ")";
    if (!h0 || h0 < 2 || !w0 || w0 < 2) {
        requestAnimationFrame(function() { urdMermaidSyncUrdMdWrapLayoutHeight(wrap); });
        return;
    }
    var padV = 20;
    var padH = 20;
    try {
        var cs = window.getComputedStyle(wrap);
        padV += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
        padH += (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    } catch (ePad) { padV = 36; padH = 36; }
    wrap.style.minHeight = Math.ceil(h0 * scale + padV) + "px";
    wrap.style.minWidth = Math.ceil(w0 * scale + padH) + "px";
}
function urdMermaidWrapAction(wrap, act) {
    if (!wrap) return;
    var zoomHost = urdMermaidZoomHostUrdMd(wrap);
    var svg = wrap.querySelector("svg");
    if (act === "zoom-in" || act === "zoom-out") {
        var scale = parseFloat(zoomHost.getAttribute("data-zoom") || wrap.getAttribute("data-zoom") || "1");
        scale = act === "zoom-in" ? Math.min(scale + 0.25, 4) : Math.max(scale - 0.25, 0.25);
        if (scale === 1) zoomHost.removeAttribute("data-zoom");
        else zoomHost.setAttribute("data-zoom", String(scale));
        wrap.removeAttribute("data-zoom");
        zoomHost.style.transformOrigin = "top center";
        zoomHost.style.transform = scale === 1 ? "none" : "scale(" + scale + ")";
        urdMermaidSyncUrdMdWrapLayoutHeight(wrap);
        return;
    }
    if (act === "fit") {
        wrap.style.minHeight = "";
        wrap.style.minWidth = "";
        wrap.removeAttribute("data-zoom");
        wrap.removeAttribute("data-nat-w");
        zoomHost.removeAttribute("data-zoom");
        zoomHost.removeAttribute("data-nat-w");
        zoomHost.style.transform = "";
        zoomHost.style.transformOrigin = "";
        try {
            document.body.removeAttribute("data-f140-bz");
            if (typeof document.body.style.zoom !== "undefined") {
                document.body.style.zoom = "";
            }
            document.body.style.transform = "";
            document.body.style.transformOrigin = "";
        } catch (eBz) {}
        if (svg) {
            svg.style.removeProperty("width");
            svg.style.removeProperty("max-width");
            svg.style.removeProperty("max-height");
            svg.style.removeProperty("height");
            svg.style.removeProperty("transform");
            try {
                svg.removeAttribute("data-pan-x");
                svg.removeAttribute("data-pan-y");
            } catch (eP) {}
            svg.style.setProperty("max-width", "100%", "important");
            svg.style.setProperty("max-height", "480px", "important");
            svg.style.setProperty("height", "auto", "important");
        }
        return;
    }
    if (!svg) return;
    if (act === "png") {
        urdMermaidSvgToPngBlob(svg, 2, function(blob) {
            if (!blob) return;
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "mermaid-diagram.png";
            a.click();
            URL.revokeObjectURL(a.href);
        });
    }
    if (act === "svg") {
        var svgStr = new XMLSerializer().serializeToString(svg);
        var a = document.createElement("a");
        a.href = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr)));
        a.download = "mermaid-diagram.svg";
        a.click();
    } else if (act === "copy") {
        urdMermaidSvgToPngBlob(svg, 2, function(blob) {
            if (!blob || !navigator.clipboard || !navigator.clipboard.write) return;
            var item = new ClipboardItem({ "image/png": blob });
            navigator.clipboard.write([item]).catch(function() {});
        });
    }
}
function bootHideNativeMermaidErrors() {
    hideNativeMermaidErrorBlocks(document);
    try {
        if (window.__urdMermaidErrObserver) return;
        var obs = new MutationObserver(function() {
            hideNativeMermaidErrorBlocks(document);
        });
        obs.observe(document.body, { childList: true, subtree: true });
        window.__urdMermaidErrObserver = obs;
    } catch (e) {}
}
function urdUpdatePreviewSrcdoc(preview, md) {
    if (preview._urdTimer) clearTimeout(preview._urdTimer);
    preview._urdTimer = setTimeout(function() {
        var innerHtml = urdRenderMarkdownToHtml(md || "");
        var css = "html,body{scrollbar-width:none;-ms-overflow-style:none;}html::-webkit-scrollbar,body::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}" +
            "body{margin:0;padding:8px 10px;font-family:Arial,'Microsoft JhengHei',sans-serif;font-size:13px;line-height:1.65;word-break:break-word;color:#111827;}" +
            "h1,h2,h3{margin:.6em 0 .4em;}p{margin:.35em 0;}pre{background:#f5f5f5;border:1px solid #ddd;padding:8px;overflow:auto;border-radius:4px;}code{background:#f5f5f5;padding:1px 4px;}" +
            "blockquote{border-left:4px solid #d0d0d0;margin:6px 0;padding:4px 8px;color:#555;}ul,ol{margin:6px 0 6px 20px;}" +
            "table{width:100%;border-collapse:collapse;margin:8px 0;border:1px solid #d1d5db;}th,td{border:1px solid #d1d5db;padding:6px 8px;vertical-align:top;}th{background:#f3f4f6;text-align:left;}" +
            "hr{border:none;border-top:1px solid #d1d5db;margin:12px 0;}del{text-decoration:line-through;color:#64748b;}mark{background:#fef08a;padding:0 2px;}" +
            "kbd{padding:2px 6px;font-size:.9em;border:1px solid #cbd5e1;border-radius:4px;background:#f1f5f9;}" +
            ".urd-task-list{list-style:none;margin-left:0;padding-left:0;}.urd-task-item{display:flex;align-items:flex-start;gap:6px;}" +
            ".urd-md-mermaid-note{font-size:12px;color:#0366d6;margin-bottom:4px;}.urd-md-mermaid-wrap{position:relative;border:1px solid #ddd;background:#fff;padding:8px;margin:6px 0;overflow:visible;width:100%;box-sizing:border-box;}.urd-md-mermaid-actions{position:absolute;top:4px;left:4px;z-index:5;display:flex;gap:3px;flex-wrap:wrap;}" +
            ".urd-md-mermaid-zoom{display:block;width:100%;max-width:100%;vertical-align:top;transform-origin:top center;box-sizing:border-box;min-height:1px;}" +
            ".urd-mm-btn{border:1px solid #bbb;background:#f5f5f5;padding:2px 8px;cursor:pointer;border-radius:2px;font-size:11px;line-height:1.4;}" +
            ".urd-mm-btn:hover{background:#ddeeff;border-color:#36c;}" +
            ".urd-md-mermaid-wrap svg{max-width:100%!important;max-height:none;width:auto!important;height:auto!important;display:block;margin:0 auto;visibility:visible;opacity:1;}" +
            "svg{max-width:100%!important;height:auto!important;}";
        var renderScript =
            "function __urdMdSrcdocBoot(){" +
            "  function __urdMmScheduleReflowPaint(){" +
            "    try{" +
            "      requestAnimationFrame(function(){" +
            "        requestAnimationFrame(function(){" +
            "          try{" +
            "            var se=document.scrollingElement||document.documentElement||document.body;" +
            "            var y=se.scrollTop||0;" +
            "            se.scrollTop=y+1;" +
            "            se.scrollTop=y;" +
            "            var wraps=document.querySelectorAll('.urd-md-mermaid-wrap');" +
            "            for(var wi=0;wi<wraps.length;wi++){" +
            "              var svg=wraps[wi].querySelector('svg');" +
            "              if(svg){" +
            "                svg.style.visibility='visible';" +
            "                svg.style.opacity='1';" +
            "                try{var bb=svg.getBBox();void bb;}catch(eB){}" +
            "                void svg.getBoundingClientRect();" +
            "              }" +
            "            }" +
            "            void document.body.offsetHeight;" +
            "            if(document.documentElement)void document.documentElement.offsetHeight;" +
            "          }catch(e1){}" +
            "        });" +
            "      });" +
            "      setTimeout(function(){" +
            "        try{" +
            "          var se2=document.scrollingElement||document.documentElement||document.body;" +
            "          var y2=se2.scrollTop||0;" +
            "          se2.scrollTop=y2+1;" +
            "          se2.scrollTop=y2;" +
            "        }catch(e2){}" +
            "      },60);" +
            "    }catch(e0){}" +
            "  }" +
            "  try{mermaid.initialize({startOnLoad:false,securityLevel:'loose',theme:'default',themeVariables:{darkMode:false}});}catch(e){}" +
            "  var ns=document.querySelectorAll('.urd-md-mermaid.mermaid');" +
            "  ns.forEach(function(n){n.setAttribute('data-mm-src',n.textContent||'');});" +
            "  function __mmSvgFallback(n){" +
            "    var raw=n.getAttribute('data-mm-src')||n.textContent||'';" +
            "    var svgF=null;" +
            "    try{var p=window.parent;" +
            "      if(/^usecaseDiagram\\b/i.test(raw)&&p&&typeof p.urdBuildSimpleUsecaseSvg==='function')svgF=p.urdBuildSimpleUsecaseSvg(raw);" +
            "      if(!svgF&&p&&typeof p.urdBuildSimpleFlowSvg==='function')svgF=p.urdBuildSimpleFlowSvg(raw);" +
            "      if(!svgF&&p&&typeof p.urdBuildSimpleClassSvg==='function')svgF=p.urdBuildSimpleClassSvg(raw);" +
            "      if(!svgF&&p&&typeof p.urdBuildSimpleSequenceSvg==='function')svgF=p.urdBuildSimpleSequenceSvg(raw);" +
            "      if(!svgF&&p&&typeof p.urdBuildSimpleStateSvg==='function')svgF=p.urdBuildSimpleStateSvg(raw);" +
            "      if(!svgF&&p&&typeof p.urdBuildSimpleErSvg==='function')svgF=p.urdBuildSimpleErSvg(raw);" +
            "      if(!svgF&&p&&typeof p.urdBuildSimpleUsecaseSvg==='function')svgF=p.urdBuildSimpleUsecaseSvg(raw);" +
            "    }catch(e){}" +
            "    if(svgF){n.innerHTML=svgF;return true;}" +
            "    n.innerHTML='<pre style=\"margin:0;padding:6px;background:#f5f5f5;border-radius:4px;font-size:12px;overflow:auto;\">'+raw+'<\\/pre>';" +
            "    return false;" +
            "  }" +
            "  function __mmPostRun(){" +
            "    ns.forEach(function(n){" +
            "      var sv=n.querySelector('svg');" +
            "      if(sv&&(sv.querySelector('.error-icon')||/Syntax error/i.test(sv.textContent||''))){" +
            "        __mmSvgFallback(n);" +
            "      }else if(!sv){" +
            "        __mmSvgFallback(n);" +
            "      }" +
            "    });" +
            "    __urdMmScheduleReflowPaint();" +
            "  }" +
            "  var nsArr=Array.prototype.slice.call(ns);" +
            "  if(nsArr.length&&typeof mermaid!=='undefined'&&typeof mermaid.run==='function'){" +
            "    mermaid.run({nodes:nsArr,suppressErrors:true}).then(__mmPostRun).catch(__mmPostRun);" +
            "  }else if(ns.length){" +
            "    ns.forEach(function(n){__mmSvgFallback(n);});" +
            "    __urdMmScheduleReflowPaint();" +
            "  }" +
            "  var __ncp=null;" +
            "  var __ncpC=[['藍','#E6F7FF','#1890FF'],['橙','#FFF7E6','#FA8C16'],['綠','#F6FFED','#52C41A'],['紅','#FFF1F0','#F5222D'],['紫','#F9F0FF','#722ED1'],['青','#E6FFFB','#13C2C2'],['深藍','#1890FF','#0050B3'],['深綠','#52C41A','#237804'],['深紅','#F5222D','#A8071A'],['灰','#F5F5F5','#8C8C8C'],['黑','#262626','#000000'],['白','#FFFFFF','#D9D9D9'],['\\u2715清除','','']];" +
            "  function __ncpClose(){if(__ncp){__ncp.remove();__ncp=null;}}" +
            "  document.addEventListener('contextmenu',function(e){" +
            "    var el=e.target,g=null;" +
            "    while(el&&el!==document.body){" +
            "      if(el.tagName&&el.tagName.toLowerCase()==='g'&&el.id&&/^flowchart-/.test(el.id)){g=el;break;}" +
            "      el=el.parentNode;" +
            "    }" +
            "    if(!g)return;" +
            "    e.preventDefault();" +
            "    var nid=g.id.replace(/^flowchart-/,'').replace(/-\\d+$/,'');" +
            "    var wrap=g.closest?g.closest('.urd-md-mermaid'):null;" +
            "    var src=wrap?wrap.getAttribute('data-mm-src')||'':'';" +
            "    __ncpClose();" +
            "    var d=document.createElement('div');" +
            "    d.style.cssText='position:fixed;z-index:9999;background:#fff;border:1px solid #bbb;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.2);padding:6px;min-width:100px;';" +
            "    d.style.left=(e.clientX+4)+'px';d.style.top=(e.clientY+4)+'px';" +
            "    var t=document.createElement('div');t.style.cssText='font-size:11px;color:#888;margin-bottom:5px;white-space:nowrap;';t.textContent='節點 ['+nid+'] 顏色';d.appendChild(t);" +
            "    var row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:3px;max-width:190px;';" +
            "    __ncpC.forEach(function(c){" +
            "      var b=document.createElement('div');b.title=c[0];" +
            "      b.style.cssText='width:24px;height:24px;border:2px solid '+(c[2]||'#ccc')+';background:'+(c[1]||'#fff')+';cursor:pointer;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:9px;box-sizing:border-box;';" +
            "      if(!c[1])b.textContent='\\u2715';" +
            "      b.addEventListener('click',function(ev){ev.stopPropagation();__ncpClose();window.parent.postMessage({type:'urd-node-color',nodeId:nid,mermaidSrc:src,fill:c[1],stroke:c[2]},'*');});" +
            "      row.appendChild(b);" +
            "    });" +
            "    d.appendChild(row);document.body.appendChild(d);__ncp=d;" +
            "    setTimeout(function(){document.addEventListener('click',function _c(){__ncpClose();document.removeEventListener('click',_c);});},0);" +
            "  });" +
            "  document.addEventListener('click',function(e){" +
            "    var btn=e.target;" +
            "    while(btn&&btn!==document.body){if(btn.classList&&btn.classList.contains('urd-mm-btn'))break;btn=btn.parentNode;}" +
            "    if(!btn||!btn.classList||!btn.classList.contains('urd-mm-btn'))return;" +
            "    var act=btn.getAttribute('data-mm-act');" +
            "    var wrap=btn.closest?btn.closest('.urd-md-mermaid-wrap'):null;" +
            "    if(!act||!wrap)return;" +
            "    var svg=wrap.querySelector('svg');" +
            "    if(!svg&&act!=='fit')return;" +
            "    if(act==='zoom-in'||act==='zoom-out'){" +
            "      var scale=parseFloat(wrap.getAttribute('data-zoom')||'1');" +
            "      scale=act==='zoom-in'?Math.min(scale+0.25,4):Math.max(scale-0.25,0.25);" +
            "      wrap.setAttribute('data-zoom',String(scale));" +
            "      if(!wrap.getAttribute('data-nat-w')){" +
            "        var vb=svg.getAttribute('viewBox'),natW=0;" +
            "        if(vb){var vbp=vb.trim().split(/\\s+/);if(vbp.length>=4)natW=parseFloat(vbp[2])||0;}" +
            "        if(!natW)natW=svg.getBoundingClientRect().width||parseFloat(svg.getAttribute('width'))||0;" +
            "        if(natW>0)wrap.setAttribute('data-nat-w',String(natW));" +
            "      }" +
            "      var storedW=parseFloat(wrap.getAttribute('data-nat-w')||'0');" +
            "      if(storedW>0){svg.style.setProperty('width',(storedW*scale)+'px','important');svg.style.setProperty('max-width','none','important');svg.style.setProperty('max-height','none','important');svg.style.setProperty('height','auto','important');}" +
            "    }else if(act==='fit'){" +
            "      wrap.removeAttribute('data-zoom');wrap.removeAttribute('data-nat-w');" +
            "      var zh=wrap.querySelector('.urd-md-mermaid-zoom');" +
            "      if(zh){zh.removeAttribute('data-zoom');zh.removeAttribute('data-nat-w');zh.style.transform='';zh.style.transformOrigin='';}" +
            "      try{document.body.removeAttribute('data-f140-bz');" +
            "        if(typeof document.body.style.zoom!=='undefined')document.body.style.zoom='';" +
            "        document.body.style.transform='';document.body.style.transformOrigin='';" +
            "      }catch(eB){}" +
            "      if(svg){svg.style.removeProperty('width');svg.style.removeProperty('max-width');svg.style.removeProperty('max-height');svg.style.removeProperty('height');svg.style.removeProperty('transform');" +
            "        try{svg.removeAttribute('data-pan-x');svg.removeAttribute('data-pan-y');}catch(eP){}" +
            "        svg.style.setProperty('max-width','100%','important');svg.style.setProperty('max-height','480px','important');svg.style.setProperty('height','auto','important');}" +
            "    }else if(act==='png'||act==='svg'||act==='copy'){" +
            "      try{window.parent.postMessage({type:'urd-mm-act',act:act,svgStr:new XMLSerializer().serializeToString(svg)},'*');}catch(e2){}" +
            "    }" +
            "  });" +
            "  var __urdActiveMmWrap=null;" +
            "  document.addEventListener('mouseover',function(e){var w=e.target&&e.target.closest&&e.target.closest('.urd-md-mermaid-wrap');if(w)__urdActiveMmWrap=w;},true);" +
            "  window.addEventListener('message',function(e){" +
            "    if(!e.data)return;" +
            "    if(e.data.type==='urd-body-zoom'){" +
            "      var sc=parseFloat(document.body.getAttribute('data-f140-bz')||'1');" +
            "      if(e.data.act==='in')sc=Math.min(Math.round((sc+0.12)*100)/100,2.5);" +
            "      else if(e.data.act==='out')sc=Math.max(Math.round((sc-0.12)*100)/100,0.5);" +
            "      else sc=1;" +
            "      document.body.setAttribute('data-f140-bz',String(sc));" +
            "      if(typeof document.body.style.zoom!=='undefined'){document.body.style.zoom=sc===1?'':(sc*100)+'%';}" +
            "      else{document.body.style.transformOrigin='0 0';document.body.style.transform=sc===1?'':'scale('+sc+')';}" +
            "      return;" +
            "    }" +
            "    if(e.data.type!=='urd-mm-ctrl'||!e.data.act)return;" +
            "    if(!/^(fit|zoom-in|zoom-out|png|svg|copy)$/.test(e.data.act))return;" +
            "    var wraps=document.querySelectorAll('.urd-md-mermaid-wrap');" +
            "    if(!wraps.length)return;" +
            "    var wrap=(__urdActiveMmWrap&&document.body.contains(__urdActiveMmWrap))?__urdActiveMmWrap:wraps[0];" +
            "    var proxy=wrap.querySelector('[data-mm-act=\"'+e.data.act+'\"]');" +
            "    if(proxy)proxy.click();" +
            "  });" +
            "  document.addEventListener('wheel',function(e){" +
            "    var el=e.target;" +
            "    while(el&&el!==document.body){if(el.classList&&el.classList.contains('urd-md-mermaid-wrap'))break;el=el.parentNode;}" +
            "    if(!el||!el.classList||!el.classList.contains('urd-md-mermaid-wrap'))return;" +
            "    e.preventDefault();" +
            "    var zb=el.querySelector('[data-mm-act=\"'+(e.deltaY<0?'zoom-in':'zoom-out')+'\"]');" +
            "    if(zb)zb.click();" +
            "  },{passive:false});" +
            "}" +
            "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',__urdMdSrcdocBoot);}else{__urdMdSrcdocBoot();}";
        var doc = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<base href="about:blank">' +
            '<scr' + 'ipt src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js" onerror="this.onerror=null;this.src=\'/EURD/JS/mermaid.min.js\'"><' + '/scr' + 'ipt>' +
            '<style>' + css + '</style></head><body>' + innerHtml +
            '<scr' + 'ipt>' + renderScript + '<' + '/scr' + 'ipt></body></html>';
        preview.srcdoc = doc;
    }, 400);
}
function initUrdReferenceMarkdown(scope, inputId, previewId, toolbarId, options) {
    var root = scope || document;
    var input = root.querySelector("#" + inputId);
    var preview = root.querySelector("#" + previewId);
    var toolbar = root.querySelector("#" + toolbarId);
    if (!input || !preview || !toolbar) return;
    var isIframe = preview.tagName === "IFRAME";
    options = options || {};
    var iframePostPreview = null;
    if (isIframe && options.iframePostPreview && typeof options.iframePostPreview.flush === "function") {
        iframePostPreview = options.iframePostPreview;
    }
    function urdIframePreviewSchedule() {
        if (iframePostPreview && typeof iframePostPreview.schedule === "function") iframePostPreview.schedule();
        else urdUpdatePreviewSrcdoc(preview, input.value || "");
    }
    function urdIframePreviewFlush() {
        if (iframePostPreview) iframePostPreview.flush();
        else urdUpdatePreviewSrcdoc(preview, input.value || "");
    }
    var popup = toolbar.querySelector(".urd-md-icon-picker-popup");
    if (popup && !popup.querySelector(".urd-md-icon-tab")) {
        popup.innerHTML = buildIconPickerContent();
    }
    if (toolbar.getAttribute("data-md-bound") !== "1") {
        toolbar.setAttribute("data-md-bound", "1");
        toolbar.addEventListener("click", function(e) {
            var btn = e.target;
            while (btn && btn !== toolbar && !btn.getAttribute("data-md-act")) btn = btn.parentNode;
            if (!btn || btn === toolbar) return;
            var act = btn.getAttribute("data-md-act");
            if (act === "fmt-bold")        { urdMdInsert(input, "**", "**", "粗體文字"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "fmt-italic") { urdMdInsert(input, "*", "*", "斜體文字"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "fmt-strike") { urdMdInsert(input, "~~", "~~", "刪除線文字"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "fmt-inline-code") { urdMdInsert(input, "`", "`", "code"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "blockquote") urdMdInsert(input, "> ", "", "引用內容");
            else if (act === "hr")         urdMdInsert(input, "\n---\n", "", "");
            else if (act === "math-inline") { urdMdInsert(input, "$", "$", "公式"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "math-block")  { urdMdInsert(input, "\n$$\n", "\n$$\n", "公式"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act && act.indexOf("math-") === 0 && act !== "math-inline" && act !== "math-block" && act !== "math-toggle") {
                var mathFormulas = {
                    "math-feynman":     "\\langle q_f, t_f \\mid q_i, t_i \\rangle = \\int \\mathcal{D}[q(t)]\\, \\exp\\!\\left(\\frac{i}{\\hbar} S[q]\\right)",
                    "math-euler":       "e^{i\\pi} + 1 = 0",
                    "math-quadratic":   "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
                    "math-taylor":      "f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x - a)^n",
                    "math-fourier":     "\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi i x \\xi}\\, dx",
                    "math-schrodinger": "i\\hbar \\frac{\\partial}{\\partial t}\\Psi(\\mathbf{r},t) = \\hat{H}\\Psi(\\mathbf{r},t)",
                    "math-normal":      "f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}}\\, e^{-\\dfrac{(x-\\mu)^2}{2\\sigma^2}}",
                    "math-bayes":       "P(A \\mid B) = \\frac{P(B \\mid A)\\, P(A)}{P(B)}",
                    "math-emc2":        "E = mc^2",
                    "math-pythagorean": "a^2 + b^2 = c^2"
                };
                var formula = mathFormulas[act];
                if (formula) urdMdInsert(input, "\n$$\n" + formula + "\n$$\n", "", "");
                try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {}
            }
            else if (act && act.indexOf("heading-") === 0 && act !== "heading-toggle") {
                var hlevel = parseInt(act.replace("heading-", "")) || 2;
                urdMdInsert(input, Array(hlevel + 1).join("#") + " ", "", "標題");
                try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {}
            }
            else if (act === "list-ul") { urdMdInsert(input, "- ", "", "清單項目"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "list-ol") { urdMdInsert(input, "1. ", "", "清單項目"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "list-check") { urdMdInsert(input, "- [ ] ", "", "待辦事項"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "list-check-done") { urdMdInsert(input, "- [x] ", "", "已完成事項"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {} }
            else if (act === "link-external")   { urdMdInsert(input, "[", "](https://)", "連結文字"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act === "link-anchor")     { urdMdInsert(input, "[", "](#section)", "錨點文字"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act === "link-auto")       { urdMdInsert(input, "<", ">", "https://"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act === "link-email")      { urdMdInsert(input, "[", "](mailto:user@example.com)", "Email"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act === "link-image")      { urdMdInsert(input, "![", "](https://)", "圖片說明"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act === "link-image-link") { urdMdInsert(input, "[![圖片說明](https://image-url)](https://", ")", "link-url"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act === "link-ref")        { urdMdInsert(input, "[", "][ref]\n\n[ref]: https://", "連結文字"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act === "link-footnote")   { urdMdInsert(input, "[^1]\n\n[^1]: ", "", "腳注說明"); try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display="none"; }); } catch(e) {} }
            else if (act && act.indexOf("code-") === 0 && act !== "code-toggle") {
                var lang = act.replace("code-", "");
                urdMdInsert(input, "\n```" + lang + "\n", "\n```\n", "");
                try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {}
            }
            else if (act === "mermaid") urdMdInsert(input, "\n```mermaid\n", "\n```\n", "graph TD\nA[開始] --> B[結束]");
            else if (act === "flowchart-sub-toggle" || act === "sequence-sub-toggle" || act === "class-sub-toggle" || act === "state-sub-toggle" || act === "er-sub-toggle" || act === "usecase-sub-toggle" || act === "gantt-sub-toggle" || act === "journey-sub-toggle" || act === "timeline-sub-toggle" || act === "requirement-sub-toggle" || act === "math-block-sub-toggle") {
                return;
            }
            else if (act && act.indexOf("table-") === 0 && act !== "table-toggle") {
                var tparts = act.split("-");
                var tcols = parseInt(tparts[1]) || 3;
                var trows = parseInt(tparts[2]) || 2;
                urdMdInsertTable(input, tcols, trows);
                try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {}
            }
            else if (act === "uml-toggle" || act === "mindmap-toggle" || act === "gantt-toggle" || act === "table-toggle" || act === "heading-toggle" || act === "list-toggle" || act === "code-toggle" || act === "fmt-toggle" || act === "math-toggle" || act === "link-toggle") {
                var wrap = btn.closest ? btn.closest(".urd-md-uml-wrap") : (btn.parentNode && btn.parentNode.classList && btn.parentNode.classList.contains("urd-md-uml-wrap") ? btn.parentNode : null);
                if (wrap) {
                    var dd = wrap.querySelector(".urd-md-uml-dropdown");
                    if (dd) {
                        var show = dd.style.display !== "block";
                        try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); root.querySelectorAll(".urd-md-icon-picker-popup").forEach(function(p){ p.style.display = "none"; }); } catch(e) {}
                        dd.style.display = show ? "block" : "none";
                        if (show) {
                            var close = function(ev){ if (!wrap.contains(ev.target)) { dd.style.display = "none"; document.removeEventListener("click", close); } };
                            setTimeout(function(){ document.addEventListener("click", close); }, 0);
                        }
                    }
                }
                return;
            }
            else if (act && act.indexOf("uml-") === 0 && act !== "uml-toggle" && act !== "gantt-toggle") {
                var key = act.replace(/^uml-/, "");
                urdMdInsertUmlTemplate(input, key);
                try { root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {}
            }
            else if (act === "icon-picker-toggle") {
                var wrap = btn.closest ? btn.closest(".urd-md-icon-picker-wrap") : (btn.parentNode && btn.parentNode.classList && btn.parentNode.classList.contains("urd-md-icon-picker-wrap") ? btn.parentNode : null);
                if (wrap) {
                    var ip = wrap.querySelector(".urd-md-icon-picker-popup");
                    if (ip) {
                        var show = ip.style.display !== "grid";
                        try { root.querySelectorAll(".urd-md-icon-picker-popup").forEach(function(p){ p.style.display = "none"; }); root.querySelectorAll(".urd-md-uml-dropdown").forEach(function(d){ d.style.display = "none"; }); } catch(e) {}
                        ip.style.display = show ? "grid" : "none";
                        if (show) {
                            var close = function(ev){ if (!wrap.contains(ev.target)) { ip.style.display = "none"; document.removeEventListener("click", close); } };
                            setTimeout(function(){ document.addEventListener("click", close); }, 0);
                        }
                    }
                }
                return;
            }
            else if (act === "icon-tab") {
                var popup = btn.parentNode; while (popup && !popup.classList.contains("urd-md-icon-picker-popup")) popup = popup.parentNode;
                if (popup) {
                    var tidx = btn.getAttribute("data-tab-idx");
                    try { popup.querySelectorAll(".urd-md-icon-tab").forEach(function(t){ t.classList.remove("urd-tab-active"); }); popup.querySelectorAll(".urd-md-icon-panel").forEach(function(p){ p.classList.remove("urd-tab-active"); }); } catch(e){}
                    btn.classList.add("urd-tab-active");
                    var panel = popup.querySelector(".urd-md-icon-panel[data-panel-idx='" + tidx + "']");
                    if (panel) panel.classList.add("urd-tab-active");
                }
                return;
            }
            else if (act === "icon-pick") {
                var icon = btn.getAttribute("data-icon");
                if (icon) urdMdInsertIcon(input, icon);
                try { root.querySelectorAll(".urd-md-icon-picker-popup").forEach(function(p){ p.style.display = "none"; }); } catch(e) {}
            }
            else if (act === "clear-md") {
                if (input.value && !window.confirm("確定要清除所有內容？")) return;
                input.value = "";
            }
            else if (act === "copy-md") {
                var txt = input.value || "";
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(txt).then(function() {
                        btn.textContent = "✔ 已複製";
                        setTimeout(function() { btn.textContent = "📋 複製"; }, 1500);
                    });
                } else {
                    input.select(); document.execCommand("copy");
                    btn.textContent = "✔ 已複製";
                    setTimeout(function() { btn.textContent = "📋 複製"; }, 1500);
                }
                return;
            }
            else if (act === "left-only") { urdMdSetLayout(input, preview, "left-only"); return; }
            else if (act === "right-only") { urdMdSetLayout(input, preview, "right-only"); return; }
            else if (act === "both") { urdMdSetLayout(input, preview, "both"); return; }
            if (isIframe) {
                urdIframePreviewSchedule();
            } else {
                preview.innerHTML = urdRenderMarkdownToHtml(input.value || "");
                urdRenderMermaidInPreview(preview);
                urdRenderMathInPreview(preview);
            }
        });
    }
    if (input.getAttribute("data-md-bound") !== "1") {
        input.setAttribute("data-md-bound", "1");
        input.addEventListener("input", function() {
            if (isIframe) {
                urdIframePreviewSchedule();
            } else {
                preview.innerHTML = urdRenderMarkdownToHtml(input.value || "");
                urdRenderMermaidInPreview(preview);
                urdRenderMathInPreview(preview);
            }
        });
    }
    if (!isIframe && preview.getAttribute("data-mm-actions-bound") !== "1") {
        preview.setAttribute("data-mm-actions-bound", "1");
        preview.addEventListener("click", function(e) {
            var btn = e.target;
            while (btn && btn !== preview && (!btn.classList || !btn.classList.contains("urd-mm-btn"))) btn = btn.parentNode;
            if (!btn || btn === preview || !btn.classList.contains("urd-mm-btn")) return;
            var act = btn.getAttribute("data-mm-act");
            var wrap = btn.closest(".urd-md-mermaid-wrap");
            if (act && wrap) urdMermaidWrapAction(wrap, act);
        });
    }
    if (isIframe && !input._urdNodeColorBound) {
        input._urdNodeColorBound = true;
        window.addEventListener("message", function(e) {
            if (!e.data || e.data.type !== "urd-node-color") return;
            var nid = e.data.nodeId;
            var src = (e.data.mermaidSrc || "").trim();
            var fill = e.data.fill || "";
            var stroke = e.data.stroke || "";
            var text = input.value;
            var esc = function(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
            var styleRx = new RegExp("([ \\t]*style[ \\t]+" + esc(nid) + "[ \\t][^\\n]*)", "g");
            var styleLine = fill ? ("  style " + nid + " fill:" + fill + ",stroke:" + stroke + ",stroke-width:2px,color:#000") : "";
            var updated = false;
            var newText = text.replace(/(```mermaid[\r\n])([\s\S]*?)([\r\n][ \t]*```)/g, function(full, open, content, close) {
                var trimC = content.trim();
                if (src && trimC.substring(0, 60) !== src.substring(0, 60)) return full;
                styleRx.lastIndex = 0;
                if (styleRx.test(content)) {
                    styleRx.lastIndex = 0;
                    content = styleLine ? content.replace(styleRx, styleLine) : content.replace(styleRx, "");
                } else if (styleLine) {
                    content = content.replace(/\n*$/, "\n" + styleLine);
                }
                styleRx.lastIndex = 0;
                updated = true;
                return open + content + close;
            });
            if (updated) {
                input.value = newText;
                input.dispatchEvent(new Event("input"));
            }
        });
    }
    if (isIframe) {
        urdIframePreviewFlush();
    } else {
        preview.innerHTML = urdRenderMarkdownToHtml(input.value || "");
        urdRenderMermaidInPreview(preview);
        urdRenderMathInPreview(preview);
        hideNativeMermaidErrorBlocks(root);
    }
}
/* 明確掛到 window，供 Markdown 預覽 iframe（srcdoc）內以 parent 呼叫簡易後援 SVG */
try {
    if (typeof window !== "undefined") {
        window.urdBuildSimpleFlowSvg = urdBuildSimpleFlowSvg;
        window.urdBuildSimpleClassSvg = urdBuildSimpleClassSvg;
        window.urdBuildSimpleStateSvg = urdBuildSimpleStateSvg;
        window.urdBuildSimpleErSvg = urdBuildSimpleErSvg;
        window.urdBuildSimpleSequenceSvg = urdBuildSimpleSequenceSvg;
        window.urdBuildSimpleUsecaseSvg = urdBuildSimpleUsecaseSvg;
    }
} catch (eExp) {}
