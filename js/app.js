/* Газетка 2.0 — інтерактивна схема. Логіка відображення. Дані — js/data.js */
(() => {
'use strict';

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function el(tag, attrs = {}, parent, text) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/* =========================================================
   1. Граф зв'язків
   Ref-и: d:<пристрій>  c:<плата>:<роз'єм>  b:<плата>  l:<місце>
   ========================================================= */
const CONNS = {};        // ref -> {ref, board, n, dir, pins, jumper, target, label}
const EDGES = new Map(); // ref -> Set(ref)
function link(a, b) {
  if (!EDGES.has(a)) EDGES.set(a, new Set());
  if (!EDGES.has(b)) EDGES.set(b, new Set());
  EDGES.get(a).add(b); EDGES.get(b).add(a);
}
const targetRef = t => t.includes(':') ? 'c:' + t : 'd:' + t;

for (const b of Object.values(BOARDS)) {
  if (b.type === 'nvg') {
    for (const dir of ['in', 'out']) {
      for (let i = 1; i <= 8; i++) {
        const n = (dir === 'in' ? 'IN_' : 'OUT_') + i;
        const ref = `c:${b.id}:${n}`;
        const e = b[dir][i];
        const target = e ? e[0] : null;
        let jumper = null;
        if (e) {
          if (e[1]) jumper = e[1];
          else if (dir === 'out') jumper = '5V';
          else { const d = DEVICES[target]; jumper = d && KINDS[d.kind].power || '5V'; }
        }
        CONNS[ref] = { ref, board: b.id, n, dir, pins: PINOUT[dir === 'in' ? 'IN' : 'OUT'].pins, jumper, target };
        if (!b.excluded) link(ref, 'b:' + b.id);
        if (target) link(ref, targetRef(target));
      }
    }
  } else if (b.type === 'w5500') {
    for (const c of b.conns) {
      const ref = `c:${b.id}:${c.n}`;
      CONNS[ref] = { ref, board: b.id, n: c.n, label: c.label, dir: 'w', pins: c.pins, target: c.to || null };
      link(ref, 'b:' + b.id);
      if (c.to) link(ref, 'd:' + c.to);
    }
  }
}
for (const d of Object.values(DEVICES)) if (d.chain) link('d:' + d.id, 'd:' + d.chain);

/* Елементи електричної шафи */
const CAB = {};   // id -> {id, type, label, text, feeds, excluded, row, door}
CAB_ROWS.forEach((row, ri) => row.items.forEach(([id, type, w, label]) => {
  if (type === 'gap') return;
  const t = CAB_TABLE[id];
  CAB[id] = { id, type, w, label: label || id, text: t ? t[0] : null, feeds: t ? t[1] : [], excluded: !!(t && t[2]), row: ri + 1 };
}));
CAB_DOOR.forEach(([id, type, x, y, front, back]) => CAB[id] = { id, type, label: front, text: `Двері шафи. Лицьовий бік: «${front}», на звороті позначено ${back}.`, feeds: [], door: true });
CAB.FAN = { id: 'FAN', type: 'fan', label: 'Вентилятор', text: 'Вентилятор у боковій стінці. Керується терморегулятором TK-4.', feeds: ['k:TK-4'] };
CAB.SWITCH.text = 'Мережевий комутатор (SWITCH). Живлення — розетка QF 1.';
for (const c of Object.values(CAB)) for (const f of c.feeds) link('k:' + c.id, f);

const boardOfConn = ref => ref.split(':')[1];
function refExists(ref) {
  const [t, a] = ref.split(':');
  if (t === 'd') return !!DEVICES[ref.slice(2)];
  if (t === 'b') return !!BOARDS[ref.slice(2)];
  if (t === 'l') return !!LOCS[a];
  if (t === 'c') return !!CONNS[ref];
  if (t === 'k') return !!CAB[ref.slice(2)];
  return false;
}
const isExcluded = ref => (ref[0] === 'b' && BOARDS[ref.slice(2)] && BOARDS[ref.slice(2)].excluded) || (ref[0] === 'k' && CAB[ref.slice(2)] && CAB[ref.slice(2)].excluded);

/* Пов'язані елементи для виділення */
function related(ref) {
  const out = new Set([ref]);
  const addDev = (dref, seen = new Set()) => {
    if (seen.has(dref)) return; seen.add(dref); out.add(dref);
    const d = DEVICES[dref.slice(2)];
    if (d && d.vfd) out.add('l:' + d.vfd);
    for (const n of EDGES.get(dref) || []) {
      if (n.startsWith('c:')) { out.add(n); out.add('b:' + boardOfConn(n)); }
      else if (n.startsWith('d:')) addDev(n, seen);
      else if (n.startsWith('k:')) { out.add(n); out.add('l:cabinet'); }
    }
  };
  const addCab = kref => {
    out.add(kref); out.add('l:cabinet');
    for (const n of EDGES.get(kref) || []) {
      if (n.startsWith('d:')) addDev(n);
      else if (n.startsWith('b:')) { out.add(n); const b = BOARDS[n.slice(2)]; if (b.loc) out.add('l:' + b.loc); }
      else out.add(n);
    }
  };
  const addConn = (cref, deep = true) => {
    out.add(cref); out.add('b:' + boardOfConn(cref));
    for (const n of EDGES.get(cref) || []) {
      if (n.startsWith('d:')) addDev(n);
      else if (n.startsWith('c:')) { out.add(n); out.add('b:' + boardOfConn(n)); if (deep) addConn(n, false); }
    }
  };
  const t = ref[0];
  if (t === 'd') addDev(ref);
  else if (t === 'c') addConn(ref);
  else if (t === 'k') addCab(ref);
  else if (t === 'b') {
    const b = BOARDS[ref.slice(2)];
    if (b.loc) out.add('l:' + b.loc);
    for (const n of EDGES.get(ref) || []) if (n.startsWith('k:')) { out.add(n); out.add('l:cabinet'); }
    for (const c of Object.values(CONNS)) if (c.board === b.id) { out.add(c.ref); if (c.target) addConn(c.ref, false); }
  } else if (t === 'l') {
    const id = ref.slice(2);
    for (const b of Object.values(BOARDS)) if (b.loc === id) out.add('b:' + b.id);
    for (const d of Object.values(DEVICES)) if (d.vfd === id) out.add('d:' + d.id);
    if (id === 'cabinet') for (const k in CAB) out.add('k:' + k);
  }
  return out;
}

/* Мітки для ref */
function connTitle(c) { return `${c.board} · ${c.label || c.n}`; }
function refLabel(ref) {
  const t = ref[0], id = ref.slice(2);
  if (t === 'd') return DEVICES[id].label;
  if (t === 'b') return id;
  if (t === 'l') return LOCS[id].name;
  if (t === 'c') return connTitle(CONNS[ref]);
  if (t === 'k') return CAB[id].id;
  return ref;
}
function targetLabel(t) {
  if (!t) return '';
  if (t.includes(':')) { const c = CONNS['c:' + t]; return '↔ ' + (c ? connTitle(c) : t); }
  return DEVICES[t] ? DEVICES[t].label : t + ' (?)';
}
function kindColor(t) {
  if (!t) return 'var(--muted)';
  if (t.includes(':')) return KINDS.SIG.color;
  const d = DEVICES[t]; return d ? KINDS[d.kind].color : 'var(--warn)';
}

/* Зона на плані за координатою */
function zoneOf(p) {
  if (!p) return null;
  for (const z of PLAN.zones) if (p[0] >= z[0] && p[0] <= z[0] + z[2] && p[1] >= z[1] && p[1] <= z[1] + z[3])
    return z[5] ? 'Магістраль · ' + (p[0] < 900 ? 'лівий' : 'правий') + ' торець' : z[4];
  const m = PLAN.magistral;
  if (p[0] >= m[0] && p[0] <= m[0] + m[2] && p[1] >= m[1] - 20 && p[1] <= m[1] + m[3] + 20) return 'Магістраль (1-й поверх)';
  if (p[1] > m[1] + m[3]) return 'Під магістраллю (рольганги 7.4 / 7.5)';
  return 'Магістраль';
}

/* =========================================================
   2. Стан
   ========================================================= */
const state = {
  sel: null, hover: null,
  views: ['plan', 'boards'], split: 2,
  labels: false, autofocus: true,
};
const VIEWS = { plan: 'Розташування', boards: 'Бокси й плати', cab: 'Шафа', bus: 'RS-485' };
const panes = [];  // {root, svg, world, vb, reg: Map(ref -> [el]), view}

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const v = (h.get('v') || '').split(',').filter(x => VIEWS[x]);
  if (v.length) { state.views = [v[0], v[1] || state.views[1]]; state.split = v.length > 1 ? 2 : 1; }
  const s = h.get('s'); if (s && refExists(s)) state.sel = s;
}
function writeHash() {
  const v = state.split === 2 ? state.views.join(',') : state.views[0];
  const s = state.sel ? '&s=' + encodeURIComponent(state.sel) : '';
  history.replaceState(null, '', '#v=' + v + s);
}

/* =========================================================
   3. Панелі, масштаб і зсув
   ========================================================= */
function makePane(i) {
  const root = document.createElement('section');
  root.className = 'pane';
  root.innerHTML = `
    <div class="pane-bar">
      <div class="tabs">${Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}">${v}</button>`).join('')}</div>
      <div class="tools">
        <button data-act="in" title="Збільшити">+</button>
        <button data-act="out" title="Зменшити">−</button>
        <button data-act="fit" title="Показати все">⤢</button>
        <button data-act="focus" title="До виділеного">◎</button>
      </div>
    </div>
    <div class="pane-title"></div>
    <svg class="canvas" xmlns="${SVGNS}"><g class="world"></g></svg>
    <div class="pane-legend"></div>`;
  const svg = root.querySelector('svg');
  const p = { i, root, svg, world: svg.querySelector('.world'), vb: null, reg: new Map(), view: null, bbox: null };
  root.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.views[i] = b.dataset.view; renderPane(p); writeHash(); });
  root.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'in') zoomAt(p, 0.75); else if (a === 'out') zoomAt(p, 1.33);
    else if (a === 'fit') fit(p); else focusSel(p, true);
  });
  setupPanZoom(p);
  return p;
}

function setVB(p, vb) { p.vb = vb; p.svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`); }
function fit(p) {
  const b = p.bbox; if (!b) return;
  const r = p.svg.getBoundingClientRect(); const ar = (r.width || 1) / (r.height || 1);
  let w = b.w + 40, h = b.h + 40;
  if (w / h > ar) h = w / ar; else w = h * ar;
  setVB(p, { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h });
}
function zoomAt(p, k, cx, cy) {
  const vb = p.vb; if (!vb) return;
  if (cx === undefined) { cx = vb.x + vb.w / 2; cy = vb.y + vb.h / 2; }
  const w = Math.max(60, Math.min(vb.w * k, 20000)), kk = w / vb.w;
  setVB(p, { x: cx - (cx - vb.x) * kk, y: cy - (cy - vb.y) * kk, w, h: vb.h * kk });
}
function toWorld(p, ev) {
  const r = p.svg.getBoundingClientRect();
  return [p.vb.x + (ev.clientX - r.left) / r.width * p.vb.w, p.vb.y + (ev.clientY - r.top) / r.height * p.vb.h];
}
function setupPanZoom(p) {
  const svg = p.svg;
  svg.addEventListener('wheel', ev => {
    ev.preventDefault();
    const [x, y] = toWorld(p, ev);
    zoomAt(p, Math.pow(1.0015, ev.deltaY), x, y);
  }, { passive: false });
  const pts = new Map(); let start = null, moved = false, pinch = null;
  svg.addEventListener('pointerdown', ev => {
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    moved = false;
    start = { x: ev.clientX, y: ev.clientY, vb: { ...p.vb } };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), vb: { ...p.vb } };
    }
  });
  svg.addEventListener('pointermove', ev => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    const r = svg.getBoundingClientRect();
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const k = pinch.d / d; const vb = pinch.vb;
      const w = vb.w * k, h = vb.h * k;
      setVB(p, { x: vb.x + (vb.w - w) / 2, y: vb.y + (vb.h - h) / 2, w, h });
      moved = true; return;
    }
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    if (!moved) svg.setPointerCapture(ev.pointerId);
    moved = true; svg.classList.add('dragging');
    setVB(p, { x: start.vb.x - dx / r.width * start.vb.w, y: start.vb.y - dy / r.height * start.vb.h, w: start.vb.w, h: start.vb.h });
  });
  const end = ev => {
    pts.delete(ev.pointerId); if (pts.size < 2) pinch = null;
    svg.classList.remove('dragging');
  };
  svg.addEventListener('pointerup', end); svg.addEventListener('pointercancel', end);
  svg.addEventListener('click', ev => {
    if (moved) { moved = false; return; }
    const it = ev.target.closest('[data-ref]');
    if (it) select(it.dataset.ref === state.sel ? null : it.dataset.ref, p);
    else select(null, p);
  });
  svg.addEventListener('mouseover', ev => {
    const it = ev.target.closest('[data-ref]');
    const r = it ? it.dataset.ref : null;
    if (r !== state.hover) { state.hover = r; applyHighlight(); renderInfo(); }
  });
  svg.addEventListener('mouseleave', () => { if (state.hover) { state.hover = null; applyHighlight(); renderInfo(); } });
}

/* Реєстрація елемента для виділення */
function item(p, ref, g, cls = '') {
  g.setAttribute('data-ref', ref);
  g.setAttribute('class', ('item ' + cls).trim());
  if (!p.reg.has(ref)) p.reg.set(ref, []);
  p.reg.get(ref).push(g);
  return g;
}

/* =========================================================
   4. Вид «Розташування» (план)
   ========================================================= */
function renderPlan(p) {
  const W = p.world;
  const [fx, fy, fw, fh] = PLAN.frame;
  p.bbox = { x: fx, y: fy, w: fw, h: fh };
  const bg = el('g', { class: 'plan-bg' }, W);
  // зони РМ та торці
  for (const z of PLAN.zones) {
    el('rect', { x: z[0], y: z[1], width: z[2], height: z[3], rx: 10, class: z[5] ? 'zone excluded' : 'zone' }, bg);
    if (z[5]) el('text', { x: z[0] + z[2] / 2, y: z[1] + z[3] - 8, class: 'zone-label small', 'text-anchor': 'middle' }, bg, z[4].split(' (')[0]);
    else el('text', { x: z[0] + 8, y: z[1] - 6, class: 'zone-label' }, bg, z[4]);
  }
  // магістраль
  const m = PLAN.magistral;
  el('rect', { x: m[0], y: m[1], width: m[2], height: m[3], rx: 6, class: 'magistral' }, bg);
  for (const t of PLAN.tracks) {
    el('line', { x1: m[0] + 125, x2: m[0] + m[2] - 125, y1: t.y, y2: t.y, class: 'track' }, bg);
    el('text', { x: m[0] + 390, y: t.y + (t.y < 700 ? -27 : 35), class: 'track-label' }, bg, t.label);
  }
  el('text', { x: m[0] + m[2] / 2, y: m[1] - 8, class: 'zone-label', 'text-anchor': 'middle' }, bg, 'МАГІСТРАЛЬ · 1-й поверх');
  // напрямок руху
  el('path', { d: 'M 1250 618 l -24 0 m 0 0 l 8 -5 m -8 5 l 8 5', class: 'flow' }, bg);
  el('path', { d: 'M 1226 762 l 24 0 m 0 0 l -8 -5 m 8 5 l -8 5', class: 'flow' }, bg);
  // ланцюги
  for (const [id, x1, y, x2, lab] of PLAN.chains) {
    el('line', { x1, x2, y1: y, y2: y, class: 'chain' }, bg);
    el('text', { x: (x1 + x2) / 2, y: y + (y < 600 || (y > 800 && y < 900) ? -10 : 22), class: 'chain-label', 'text-anchor': 'middle' }, bg, lab);
  }
  // рольганги
  for (const [id, x, y1, y2] of PLAN.rollers) {
    el('rect', { x: x - 11, y: Math.min(y1, y2), width: 22, height: Math.abs(y2 - y1), class: 'roller' }, bg);
    for (let yy = Math.min(y1, y2) + 6; yy < Math.max(y1, y2); yy += 9) el('line', { x1: x - 9, x2: x + 9, y1: yy, y2: yy, class: 'roller-bar' }, bg);
  }
  // вузли-перемещателі
  for (const [n, [x, y]] of Object.entries(NODES)) {
    el('rect', { x: x - 13, y: y - 13, width: 26, height: 26, rx: 4, class: 'node' }, bg);
    el('text', { x, y: y + 4, class: 'node-label', 'text-anchor': 'middle' }, bg, n);
  }
  // місця (бокси)
  for (const [id, L] of Object.entries(LOCS)) {
    const [x, y, w, h] = L.rect;
    const g = item(p, 'l:' + id, el('g', {}, W), 'loc' + (L.excluded ? ' excluded' : ''));
    el('rect', { x, y, width: w, height: h, rx: 5 }, g);
    el('text', { x: x + w / 2, y: y + h / 2 + 4, 'text-anchor': 'middle' }, g, L.name.replace(' · ', ' '));
    el('title', {}, g, `${L.name} — ${L.side}`);
  }
  // пристрої
  const devLayer = el('g', {}, W);
  for (const d of Object.values(DEVICES)) {
    if (!d.pos) continue;
    const g = item(p, 'd:' + d.id, el('g', {}, devLayer), 'dev k-' + d.kind + (d.assumed ? ' assumed' : '') + (d.unconnected ? ' unconnected' : ''));
    g.style.setProperty('--c', KINDS[d.kind].color);
    if (d.beam) el('line', { x1: d.pos[0][0], y1: d.pos[0][1], x2: d.pos[1][0], y2: d.pos[1][1], class: 'beam' }, g);
    d.pos.forEach(([x, y], i) => {
      drawGlyph(g, d.kind, x, y);
      if (i) return;
      // пристрої перемещателя — підпис назовні від вузла
      let lx = x + 9, ly = y - 8, anchor = 'start';
      if (d.node) {
        const [nx, ny] = NODES[d.node];
        if (x < nx) { lx = x - 8; anchor = 'end'; } else lx = x + 8;
        ly = y < ny ? y - 6 : y + 13;
      }
      el('text', { x: lx, y: ly, class: 'plan-label', 'text-anchor': anchor }, g, d.label);
    });
    el('title', {}, g, d.label + ' — ' + KINDS[d.kind].name);
  }
  p.legend = [['RP', 'тара'], ['INDU', 'IND верх'], ['INDD', 'IND низ'], ['INDC', 'IND ланцюга'], ['UD', 'ЧП підйому'], ['F', 'ЧП роликів'], ['SC', 'сканер'], ['L', 'перетин']];
}

function drawGlyph(g, kind, x, y) {
  const grp = KINDS[kind].group;
  if (grp === 'drive') el('rect', { x: x - 6, y: y - 6, width: 12, height: 12, rx: 2, class: 'glyph' }, g);
  else if (kind === 'SC') { el('circle', { cx: x, cy: y, r: 9, class: 'glyph' }, g); el('text', { x, y: y + 3, class: 'glyph-t', 'text-anchor': 'middle' }, g, 'SC'); }
  else if (kind === 'BARR') el('rect', { x: x - 28, y: y - 4, width: 56, height: 8, rx: 2, class: 'glyph' }, g);
  else if (kind === 'RP') el('path', { d: `M ${x - 6} ${y - 6} h 7 a 6 6 0 0 1 0 12 h -7 z`, class: 'glyph' }, g);
  else if (kind === 'L') el('path', { d: `M ${x - 8} ${y + 5} l 4 -10 h 12 l -4 10 z`, class: 'glyph' }, g);
  else el('circle', { cx: x, cy: y, r: 5.5, class: 'glyph' }, g);
}

/* =========================================================
   5. Вид «Плати»
   ========================================================= */
const BW = 400;        // ширина плати NVG
const PIN_W = 14;

function drawNVG(p, parent, b, x, y) {
  const g = el('g', { transform: `translate(${x},${y})` }, parent);
  if (b.excluded) {
    const bg = item(p, 'b:' + b.id, el('g', {}, g), 'board excluded');
    el('rect', { x: 0, y: 0, width: 190, height: 64, rx: 8 }, bg);
    el('text', { x: 12, y: 26, class: 'b-title' }, bg, b.id);
    el('text', { x: 12, y: 46, class: 'b-sub' }, bg, 'поза схемою');
    el('title', {}, bg, b.role || '');
    return { w: 190, h: 64 };
  }
  const LAB = 118, BODY = 132;
  const bodyY = LAB;
  // корпус
  const bg = item(p, 'b:' + b.id, el('g', {}, g), 'board');
  el('rect', { x: 0, y: bodyY, width: BW, height: BODY, rx: 8, class: 'pcb' }, bg);
  el('text', { x: BW / 2, y: bodyY + 62, class: 'b-title', 'text-anchor': 'middle' }, bg, b.id);
  el('text', { x: BW / 2, y: bodyY + 80, class: 'b-sub', 'text-anchor': 'middle' }, bg, (b.aka[0] || '') + ' · NVG030_V1');
  // роз'єми
  for (const dir of ['in', 'out']) {
    for (let i = 1; i <= 8; i++) {
      const n = (dir === 'in' ? 'IN_' : 'OUT_') + i;
      const c = CONNS[`c:${b.id}:${n}`];
      const cx = 14 + (i - 1) * 47.5;
      const cy = dir === 'in' ? bodyY + 6 : bodyY + BODY - 40;
      const cg = item(p, c.ref, el('g', { transform: `translate(${cx},${cy})` }, g), 'conn' + (c.target ? '' : ' free'));
      cg.style.setProperty('--c', kindColor(c.target));
      el('rect', { x: -2, y: -2, width: 3 * PIN_W + 4, height: 38, rx: 4, class: 'conn-hit' }, cg);
      const pinY = dir === 'in' ? 0 : 20;
      c.pins.forEach((pin, k) => {
        el('rect', { x: k * PIN_W, y: pinY, width: PIN_W - 2, height: 13, rx: 2, class: 'pin' }, cg);
        const short = { '#IN': 'IN', '#SIGA': 'SA', '#SIGB': 'SB' }[pin] || pin;
        el('text', { x: k * PIN_W + (PIN_W - 2) / 2, y: pinY + (dir === 'in' ? 21 : -3), class: 'pin-t', 'text-anchor': 'middle' }, cg, short);
      });
      // джампер
      if (c.jumper) {
        const jy = dir === 'in' ? 25 : 6;
        el('text', { x: 3 * PIN_W / 2, y: jy + 7, class: 'jmp jmp-' + c.jumper, 'text-anchor': 'middle' }, cg, 'J ' + c.jumper);
      }
      el('text', { x: 3 * PIN_W / 2, y: dir === 'in' ? -6 : 46, class: 'conn-n', 'text-anchor': 'middle' }, cg, n.replace('_', ''));
      // підпис пристрою (вертикально)
      const tx = 3 * PIN_W / 2 + 3;
      const lab = c.target ? targetLabel(c.target) : '—';
      if (dir === 'in') el('text', { x: tx, y: -16, transform: `rotate(-90 ${tx} -16)`, class: 'conn-lab' }, cg, lab);
      else el('text', { x: tx, y: 56, transform: `rotate(90 ${tx} 56)`, class: 'conn-lab' }, cg, lab);
      el('title', {}, cg, `${b.id} · ${n} → ${c.target ? targetLabel(c.target) : 'вільний'}`);
    }
  }
  return { w: BW, h: LAB + BODY + LAB };
}

function drawW5500(p, parent, b, x, y) {
  const g = el('g', { transform: `translate(${x},${y})` }, parent);
  const rows = b.conns.length, H = 64 + rows * 26;
  const bg = item(p, 'b:' + b.id, el('g', {}, g), 'board');
  el('rect', { x: 0, y: 0, width: BW, height: H, rx: 8, class: 'pcb w5500' }, bg);
  el('text', { x: 14, y: 26, class: 'b-title' }, bg, b.id);
  el('text', { x: 14, y: 44, class: 'b-sub' }, bg, (b.aka.slice(0, 2).join(' · ')) + ' · CTRL5500 V1');
  b.conns.forEach((c, i) => {
    const C = CONNS[`c:${b.id}:${c.n}`];
    const cg = item(p, C.ref, el('g', { transform: `translate(14,${58 + i * 26})` }, g), 'conn' + (C.target ? '' : ' free'));
    let tgt = c.to;
    if (!tgt) { // зв'язок з іншою платою
      const back = [...(EDGES.get(C.ref) || [])].find(r => r.startsWith('c:'));
      tgt = back ? back.slice(2) : null;
    }
    cg.style.setProperty('--c', tgt ? kindColor(tgt) : 'var(--muted)');
    el('rect', { x: -4, y: -2, width: BW - 20, height: 22, rx: 4, class: 'conn-hit' }, cg);
    el('rect', { x: 0, y: 2, width: 104, height: 16, rx: 3, class: 'w-chip' }, cg);
    el('text', { x: 52, y: 14, class: 'w-chip-t', 'text-anchor': 'middle' }, cg, c.label);
    el('text', { x: 112, y: 14, class: 'pin-t wide' }, cg, c.pins.join(' / '));
    el('text', { x: BW - 30, y: 14, class: 'conn-lab', 'text-anchor': 'end' }, cg, tgt ? targetLabel(tgt).replace('↔ ', '↔ ') : '—');
  });
  return { w: BW, h: H };
}

function boardsByLoc(loc) { return Object.values(BOARDS).filter(b => b.loc === loc); }

function drawGroup(p, parent, locId, x, y) {
  const L = LOCS[locId];
  const g = el('g', { transform: `translate(${x},${y})` }, parent);
  const frame = item(p, 'l:' + locId, el('g', {}, g), 'group' + (L.excluded ? ' excluded' : ''));
  const inner = el('g', { transform: 'translate(20,44)' }, g);
  let cx = 0, maxH = 0;
  const bs = boardsByLoc(locId).sort((a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0));
  // невеликі «поза схемою» плати складаємо в стовпчик
  const excl = bs.filter(b => b.excluded), full = bs.filter(b => !b.excluded);
  for (const b of full) {
    const s = b.type === 'w5500' ? drawW5500(p, inner, b, cx, b.type === 'w5500' ? 118 : 0) : drawNVG(p, inner, b, cx, 0);
    const hh = b.type === 'w5500' ? s.h + 118 : s.h;
    cx += s.w + 30; maxH = Math.max(maxH, hh);
  }
  if (excl.length) {
    let ey = full.length ? 118 : 0;
    for (const b of excl) { drawNVG(p, inner, b, cx, ey); ey += 76; }
    cx += 190 + 30; maxH = Math.max(maxH, ey);
  }
  // частотники/модулі в цьому місці
  const drives = Object.values(DEVICES).filter(d => d.vfd === locId);
  const extra = (typeof EXTRA_DRIVES !== 'undefined' && EXTRA_DRIVES[locId]) || [];
  let chipY = maxH + 18, chipX = 0;
  const width = Math.max(cx - 30, 420);
  if (drives.length || extra.length) {
    el('text', { x: 0, y: chipY, class: 'chips-title' }, inner, KINDS[drives[0] ? drives[0].kind : 'UD'].group === 'periph' ? 'Периферія:' : 'Частотники в цьому місці:');
    chipY += 10;
    const chip = (label, ref, color, excluded) => {
      const w = Math.max(56, label.length * 6.6 + 16);
      if (chipX + w > width) { chipX = 0; chipY += 26; }
      const cg = ref ? item(p, ref, el('g', { transform: `translate(${chipX},${chipY})` }, inner), 'chip') : el('g', { transform: `translate(${chipX},${chipY})`, class: 'chip excluded' }, inner);
      if (color) cg.style.setProperty('--c', color);
      el('rect', { width: w, height: 20, rx: 10 }, cg);
      el('text', { x: w / 2, y: 14, 'text-anchor': 'middle' }, cg, label);
      if (excluded) el('title', {}, cg, 'Верхні поверхи — поза схемою');
      chipX += w + 6;
    };
    drives.forEach(d => chip(d.label, 'd:' + d.id, KINDS[d.kind].color));
    extra.forEach(t => chip(t, null, null, true));
    chipY += 30;
  } else chipY = maxH + 4;
  const W = width + 40, H = chipY + 44;
  el('rect', { x: 0, y: 0, width: W, height: H, rx: 12 }, frame);
  el('text', { x: 18, y: 28, class: 'g-title' }, frame, L.name);
  el('text', { x: 18 + L.name.length * 10.5 + 14, y: 28, class: 'g-sub' }, frame, L.side);
  return { w: W, h: H };
}

/* ---- Реалістичні плати та бокси (рендери з документів) ---- */
function imgEl(parent, src, x, y, w, h, cls) {
  return el('image', { href: src, x, y, width: w, height: h, preserveAspectRatio: 'none', class: cls || 'bimg' }, parent);
}
function spotLayer(p, parent, img, x, y, s) {
  for (const [loc, lx, ly, lw, lh] of img.locs || []) {
    const r = item(p, 'l:' + loc, el('rect', { x: x + lx * s, y: y + ly * s, width: lw * s, height: lh * s, rx: 8 }, parent), 'spot-loc');
    el('title', {}, r, LOCS[loc].name);
  }
  for (const [ref, sx, sy, sw, sh, tip] of img.spots) {
    const r = el('rect', { x: x + sx * s, y: y + sy * s, width: sw * s, height: sh * s, rx: 4 }, parent);
    if (ref && refExists(ref)) {
      item(p, ref, r, 'spot' + (isExcluded(ref) ? ' excluded' : ''));
      el('title', {}, r, refLabel(ref) + (isExcluded(ref) ? ' — поза схемою' : ''));
    } else { r.setAttribute('class', 'spot dead'); el('title', {}, r, tip || ''); }
  }
}

const NVG_DW = 520, LAB = 150;
function drawNVGImg(p, parent, b, x, y) {
  const s = NVG_DW / NVG_IMG.w, DH = NVG_IMG.h * s;
  const g = el('g', { transform: `translate(${x},${y})` }, parent);
  const tg = item(p, 'b:' + b.id, el('g', {}, g), 'board-img' + (b.excluded ? ' excluded' : ''));
  const iy = 46 + (b.excluded ? 0 : LAB);
  el('text', { x: 0, y: 18, class: 'b-title2' }, tg, b.id);
  el('text', { x: 0, y: 36, class: 'b-sub2' }, tg, [b.aka[0], 'NVG030_V1'].filter(Boolean).join(' · '));
  el('rect', { x: -5, y: iy - 5, width: NVG_DW + 10, height: DH + 10, rx: 10, class: 'board-frame' }, tg);
  imgEl(tg, NVG_IMG.src, 0, iy, NVG_DW, DH);
  el('title', {}, tg, b.id + (b.role ? ' — ' + b.role : ''));
  if (b.excluded) {
    el('rect', { x: 0, y: iy, width: NVG_DW, height: DH, class: 'excl-veil' }, tg);
    el('text', { x: NVG_DW / 2, y: iy + DH / 2 + 8, class: 'excl-text', 'text-anchor': 'middle' }, tg, 'поза схемою');
    return { w: NVG_DW, h: iy + DH + 10 };
  }
  for (const dir of ['in', 'out']) for (let i = 0; i < 8; i++) {
    const n = (dir === 'in' ? 'IN_' : 'OUT_') + (i + 1);
    const c = CONNS[`c:${b.id}:${n}`];
    const r = NVG_IMG[dir](i);
    const cg = item(p, c.ref, el('g', {}, g), 'conn2' + (c.target ? '' : ' free'));
    cg.style.setProperty('--c', kindColor(c.target));
    el('rect', { x: r.x * s, y: iy + r.y * s, width: r.w * s, height: r.h * s, rx: 5, class: 'conn-hit2' }, cg);
    const cx = (r.x + r.w / 2) * s + 4;
    const lab = c.target ? targetLabel(c.target) : '—';
    if (dir === 'in') {
      el('text', { x: cx, y: iy - 10, transform: `rotate(-90 ${cx} ${iy - 10})`, class: 'conn-lab2' }, cg, lab);
      if (c.jumper) {
        const j = NVG_IMG.jIn(i), yy = c.jumper === '12V' ? j.y12 : j.y5;
        el('rect', { x: j.x * s, y: iy + yy * s, width: 46 * s, height: 30 * s, rx: 3, class: 'jmp-mark jmp-' + c.jumper }, cg);
      }
    } else {
      el('text', { x: cx, y: iy + DH + 10, transform: `rotate(90 ${cx} ${iy + DH + 10})`, class: 'conn-lab2' }, cg, lab);
    }
    el('title', {}, cg, `${b.id} · ${n} → ${lab}${c.jumper ? ' · джампер ' + c.jumper : ''}`);
  }
  return { w: NVG_DW, h: iy + DH + LAB };
}

const W_DW = 430;
function drawW5500Img(p, parent, b, x, y) {
  const s = W_DW / W5500_IMG.w, DH = W5500_IMG.h * s;
  const g = el('g', { transform: `translate(${x},${y})` }, parent);
  const tg = item(p, 'b:' + b.id, el('g', {}, g), 'board-img');
  const iy = 46 + LAB;
  el('text', { x: 0, y: 18, class: 'b-title2' }, tg, b.id);
  el('text', { x: 0, y: 36, class: 'b-sub2' }, tg, [b.aka[0], 'CTRL5500 V1'].filter(Boolean).join(' · '));
  el('rect', { x: -5, y: iy - 5, width: W_DW + 10, height: DH + 10, rx: 10, class: 'board-frame' }, tg);
  imgEl(tg, W5500_IMG.src, 0, iy, W_DW, DH);
  el('title', {}, tg, b.id + ' — ' + (b.role || ''));
  const LX = W_DW + 40;
  b.conns.forEach((c, k) => {
    const C = CONNS[`c:${b.id}:${c.n}`];
    let tgt = c.to;
    if (!tgt) { const back = [...(EDGES.get(C.ref) || [])].find(r => r.startsWith('c:')); tgt = back ? back.slice(2) : null; }
    const cg = item(p, C.ref, el('g', {}, g), 'conn2' + (tgt ? '' : ' free'));
    cg.style.setProperty('--c', tgt ? kindColor(tgt) : 'var(--muted)');
    const r = W5500_IMG.conns[c.n];
    const rx = r[0] * s, ry = iy + r[1] * s, rw = r[2] * s, rh = r[3] * s;
    el('rect', { x: rx, y: ry, width: rw, height: rh, rx: 4, class: 'conn-hit2' }, cg);
    const ly = iy - 20 + k * 26;
    el('path', { d: `M ${rx + rw} ${ry + rh / 2} L ${LX - 8} ${ly - 4}`, class: 'leader' }, cg);
    el('text', { x: LX, y: ly, class: 'w-lab' }, cg, c.label);
    el('text', { x: LX + 98, y: ly, class: 'conn-lab2' }, cg, tgt ? targetLabel(tgt) : '—');
    el('title', {}, cg, `${b.id} · ${c.label} (${c.pins.join(' / ')}) → ${tgt ? targetLabel(tgt) : 'вільний'}`);
  });
  return { w: LX + 270, h: iy + DH + 40 };
}

function drawBoardImg(p, parent, b, x, y) { return b.type === 'w5500' ? drawW5500Img(p, parent, b, x, y) : drawNVGImg(p, parent, b, x, y); }

/* Секція: креслення боксу + реалістичні плати поруч */
function drawBoxSection(p, parent, img, title, sub, x, y, boardIds, H = 620) {
  const g = el('g', { transform: `translate(${x},${y})` }, parent);
  const s = H / img.h, IW = img.w * s;
  el('rect', { x: -20, y: -20, width: 10, height: 10, class: 'sec-frame' }, g); // розмір задамо нижче
  el('text', { x: 0, y: 6, class: 'g-title' }, g, title);
  el('text', { x: 0, y: 26, class: 'g-sub' }, g, sub);
  const iy = 44;
  el('rect', { x: -4, y: iy - 4, width: IW + 8, height: H + 8, rx: 8, class: 'box-frame' }, g);
  imgEl(g, img.src, 0, iy, IW, H, 'bimg box-img');
  spotLayer(p, g, img, 0, iy, s);
  // плати
  let bx = IW + 60, by = 0, rowH = 0, maxW = bx;
  const PER_ROW = boardIds.length === 4 ? 4 : 3;
  boardIds.forEach((id, k) => {
    if (k && k % PER_ROW === 0) { by += rowH + 30; rowH = 0; bx = IW + 60; }
    const sz = drawBoardImg(p, g, BOARDS[id], bx, by);
    bx += sz.w + 60; rowH = Math.max(rowH, sz.h); maxW = Math.max(maxW, bx);
  });
  let h = Math.max(iy + H + 20, by + rowH);
  // периферія та частотники поза боксами
  const locIds = (img.locs || []).map(l => l[0]);
  const per = Object.values(DEVICES).filter(d => d.vfd && locIds.some(l => d.vfd === 'rmTable' + l.slice(2, 3)) && KINDS[d.kind].group === 'periph');
  if (per.length && /^rm\d/.test(locIds[0])) {
    const tbl = 'rmTable' + locIds[0].slice(2, 3);
    h = drawChips(p, g, 0, h + 10, maxW, 'Периферія робочого столу:', Object.values(DEVICES).filter(d => d.vfd === tbl), tbl) + 10;
  }
  const fr = g.firstChild; fr.setAttribute('width', maxW + 10); fr.setAttribute('height', h + 30); fr.setAttribute('rx', 14);
  return { w: maxW, h: h + 10 };
}
function drawChips(p, g, x, y, width, title, devs, locId) {
  const tg = locId ? item(p, 'l:' + locId, el('text', { x, y, class: 'chips-title' }, g, title), 'chips-head') : el('text', { x, y, class: 'chips-title' }, g, title);
  let cx = 0, cy = y + 10;
  for (const d of devs) {
    const w = Math.max(56, d.label.length * 6.6 + 16);
    if (cx + w > width) { cx = 0; cy += 26; }
    const cg = item(p, 'd:' + d.id, el('g', { transform: `translate(${x + cx},${cy})` }, g), 'chip');
    cg.style.setProperty('--c', KINDS[d.kind].color);
    el('rect', { width: w, height: 20, rx: 10 }, cg);
    el('text', { x: w / 2, y: 14, 'text-anchor': 'middle' }, cg, d.label);
    cx += w + 6;
  }
  return cy + 26;
}

function renderBoards(p) {
  const W = p.world;
  let y = 0;
  // бокові вигляди
  el('text', { x: 0, y: -30, class: 'col-title' }, W, 'РОЗТАШУВАННЯ БОКСІВ НА СОРТУВАЛЬНИКУ');
  let sx = 0;
  for (const side of SIDE_IMG) {
    const SW = 1500, s = SW / side.w, SH = side.h * s;
    const g = el('g', { transform: `translate(${sx},${y})` }, W);
    el('text', { x: 0, y: 6, class: 'g-title' }, g, side.title);
    el('rect', { x: -4, y: 20, width: SW + 8, height: SH + 8, rx: 8, class: 'box-frame' }, g);
    imgEl(g, side.src, 0, 24, SW, SH, 'bimg box-img');
    spotLayer(p, g, side, 0, 24, s);
    sx += SW + 120;
  }
  y += 680;
  // бокси магістралі
  el('text', { x: 0, y: y - 30, class: 'col-title' }, W, 'МАГІСТРАЛЬ — бокси на рамі');
  const SEC = [
    ['boxA', 'Box A', 'Сторона A · плати COMMUTATOR, MASTER, CROSSING 1'],
    ['boxB', 'Box B', 'Сторона A · плати CROSSING 2, CROSSING 3, CONVEYOR 2'],
    ['boxC', 'Box C', 'Сторона B · CONVEYOR 1 (+ плати верхніх поверхів)'],
    ['boxD', 'Box D', 'Сторона B · плати верхніх поверхів'],
  ];
  let maxW = 0;
  for (const [id, t, sub] of SEC) {
    const ids = BOX_IMG[id].spots.filter(s => s[0] && s[0].startsWith('b:')).map(s => s[0].slice(2));
    const sz = drawBoxSection(p, W, BOX_IMG[id], t, sub, 0, y, ids);
    y += sz.h + 90; maxW = Math.max(maxW, sz.w);
  }
  // окремі плати на рамі
  el('text', { x: 0, y: y - 30, class: 'col-title' }, W, 'ОКРЕМІ ПЛАТИ НА РАМІ');
  let lx = 0, lh = 0;
  for (const [loc, li] of Object.entries(LONE_IMG)) {
    const g = el('g', { transform: `translate(${lx},${y})` }, W);
    const H = 260, s = H / li.h, IW = li.w * s;
    el('text', { x: 0, y: 6, class: 'g-title' }, g, LOCS[loc].name);
    el('text', { x: 0, y: 26, class: 'g-sub' }, g, li.title);
    el('rect', { x: -4, y: 40, width: IW + 8, height: H + 8, rx: 8, class: 'box-frame' }, g);
    imgEl(g, li.src, 0, 44, IW, H, 'bimg box-img');
    spotLayer(p, g, Object.assign({ locs: [[loc, 0, 0, li.w, li.h]] }, li), 0, 44, s);
    let w = IW;
    const live = boardsByLoc(loc).filter(b => !b.excluded);
    for (const b of live) { const sz = drawBoardImg(p, g, b, IW + 50, 0); w = IW + 50 + sz.w; lh = Math.max(lh, sz.h); }
    lh = Math.max(lh, 320);
    lx += w + 100;
  }
  y += lh + 100; maxW = Math.max(maxW, lx);
  const yLeft = y;
  // робочі місця — другий стовпчик
  const X2 = maxW + 200;
  y = 680;
  el('text', { x: X2, y: y - 30, class: 'col-title' }, W, 'РОБОЧІ МІСЦЯ — бокси над столом');
  let maxW2 = 0;
  for (const r of [1, 2, 3]) {
    const img = BOX_IMG['rm' + r];
    const ids = img.spots.filter(s => s[0] && s[0].startsWith('b:')).map(s => s[0].slice(2));
    const sz = drawBoxSection(p, W, img, `РМ_${r}`, `Box_1: W5500 PL${r}, P_LINE ${r} · Box_2: ${ids[2]}, ${ids[3]}`, X2, y, ids, 640);
    y += sz.h + 90; maxW2 = Math.max(maxW2, sz.w);
  }
  // частотники поза боксами
  el('text', { x: X2, y: y - 30, class: 'col-title' }, W, 'ЧАСТОТНИКИ В ОКРЕМИХ БОКСАХ НА РАМІ');
  let rx = 0;
  for (const loc of ['rail75', 'rail71', 'rail72', 'rail73']) {
    const sz = drawGroup(p, W, loc, X2 + rx, y); rx += sz.w + 40;
  }
  y += 170;
  p.bbox = { x: -40, y: -70, w: Math.max(X2 + Math.max(maxW2, rx), sx) + 80, h: Math.max(y, yLeft) + 80 };
  p.legend = null;
}

/* =========================================================
   5b. Вид «Шафа»
   ========================================================= */
function renderCab(p) {
  const W = p.world;
  const U = 38, MH = 96, ROWH = 168, PX = 40, PW = 30.5 * U + 80;
  const rows = CAB_ROWS.length;
  const PH = 120 + rows * ROWH;
  const g = el('g', {}, W);
  // корпус шафи
  el('rect', { x: -30, y: -40, width: PW + 60, height: PH + 70, rx: 10, class: 'cab-body' }, g);
  el('rect', { x: 0, y: 0, width: PW, height: PH, rx: 4, class: 'cab-plate' }, g);
  el('text', { x: 0, y: -60, class: 'col-title' }, g, 'ЕЛЕКТРИЧНА ШАФА — монтажна панель (за фото та таблицею автоматів)');
  // вентилятор
  const fg = item(p, 'k:FAN', el('g', { transform: `translate(${-30 + 4}, 30)` }, g), 'cab-item');
  el('rect', { x: -70, y: 0, width: 64, height: 64, rx: 6, class: 'fan' }, fg);
  el('circle', { cx: -38, cy: 32, r: 26, class: 'fan-r' }, fg);
  el('text', { x: -38, y: 84, 'text-anchor': 'middle', class: 'cab-t' }, fg, 'Вентилятор');
  CAB_ROWS.forEach((row, ri) => {
    const ry = 40 + ri * ROWH;
    // DIN-рейка
    el('rect', { x: PX - 10, y: ry + MH / 2 - 7, width: PW - 2 * PX + 20, height: 14, class: 'din' }, g);
    let x = PX;
    for (const [id, type, w, label] of row.items) {
      const iw = w * U;
      if (type !== 'gap') drawCabItem(p, g, CAB[id], type, x, ry, iw, MH, row.nums);
      x += iw + 2;
    }
    // кабель-канал під рядом
    const dy = ry + MH + 26;
    if (ri < rows - 1) {
      el('rect', { x: PX - 20, y: dy, width: PW - 2 * PX + 40, height: 34, rx: 3, class: 'duct' }, g);
      for (let xx = PX - 10; xx < PW - PX + 10; xx += 14) el('line', { x1: xx, x2: xx, y1: dy + 3, y2: dy + 12, class: 'duct-slot' }, g);
    }
    for (const [t, ux] of (row.label || []).concat(row.note || [])) {
      const tx = PX + ux * U, ty = (row.note ? ry - 14 : ry - 46);
      const lw = t.length * 7.2 + 16;
      el('rect', { x: tx, y: ty - 14, width: lw, height: 20, rx: 2, class: 'sticker' }, g);
      el('text', { x: tx + 8, y: ty + 1, class: 'sticker-t' }, g, t);
    }
  });
  // двері
  const DX = PW + 140, DW = 340, DHt = 700;
  const dg = el('g', { transform: `translate(${DX},0)` }, W);
  el('text', { x: 0, y: -60, class: 'col-title' }, dg, 'ДВЕРІ ШАФИ — лицьовий бік');
  el('rect', { x: 0, y: -40, width: DW, height: DHt, rx: 10, class: 'door' }, dg);
  el('rect', { x: 100, y: -10, width: 140, height: 70, rx: 4, class: 'door-win' }, dg);
  for (const [id, type, x, y] of CAB_DOOR) drawDoorItem(p, dg, CAB[id], type, x, y + 80);
  el('text', { x: 0, y: DHt - 10, class: 'g-sub' }, dg, 'Позначення — за написами на зворотному боці дверей');
  p.bbox = { x: -130, y: -90, w: DX + DW + 160, h: PH + 140 };
  p.legend = null;
}

function drawCabItem(p, parent, c, type, x, y, w, h, nums) {
  const g = item(p, 'k:' + c.id, el('g', { transform: `translate(${x},${y})` }, parent), 'cab-item' + (c.excluded ? ' excluded' : '') + (c.feeds.length || c.text ? '' : ' plain'));
  const isMcb = type.startsWith('mcb');
  const lampW = type.endsWith('l') ? 38 : 0;
  const bw = w - lampW;
  if (type === 'bus') {
    el('rect', { x: 0, y: h / 2 - 12, width: w, height: 24, rx: 3, class: 'busbar' }, g);
    for (let xx = 10; xx < w; xx += 18) el('circle', { cx: xx, cy: h / 2, r: 4, class: 'screw' }, g);
    el('text', { x: 6, y: h / 2 - 18, class: 'cab-t' }, g, c.label);
  } else if (type === 'psu') {
    for (let i = 0; i < 8; i++) {
      const px = (i % 4) * (w / 4), py = Math.floor(i / 4) * 54;
      el('rect', { x: px + 4, y: py, width: w / 4 - 8, height: 48, rx: 3, class: 'psu' }, g);
      for (let k = 0; k < 6; k++) el('rect', { x: px + 14 + k * 14, y: py + 32, width: 9, height: 10, class: 'psu-term' }, g);
      el('text', { x: px + 14, y: py + 20, class: 'cab-t small' }, g, 'БП ' + (i + 1));
    }
    el('text', { x: 0, y: 128, class: 'cab-t' }, g, c.label);
  } else if (type === 'term') {
    for (let k = 0; k < w / 10; k++) el('rect', { x: k * 10, y: 10, width: 8, height: h - 20, rx: 1, class: 'terminal' }, g);
  } else {
    el('rect', { x: 0, y: 0, width: bw, height: h, rx: 4, class: 'module' + (type === 'dev' && c.id === 'VC-411' ? ' blue' : '') + (type === 'sw' ? ' sw' : '') }, g);
    // гвинти клем
    for (let xx = 10; xx < bw - 4; xx += 19) { el('circle', { cx: xx, cy: 10, r: 4, class: 'screw' }, g); el('circle', { cx: xx, cy: h - 10, r: 4, class: 'screw' }, g); }
    if (isMcb) {
      el('rect', { x: 6, y: h / 2 + 8, width: bw - 12, height: 16, rx: 2, class: 'lever' }, g);
      el('rect', { x: 3, y: 20, width: bw - 6, height: 24, rx: 2, class: 'tag' }, g);
      el('text', { x: bw / 2, y: 37, 'text-anchor': 'middle', class: 'tag-t' }, g, c.id.replace(' ', ' '));
      if (lampW) { el('rect', { x: bw + 1, y: 0, width: lampW - 2, height: h, rx: 4, class: 'module' }, g); el('circle', { cx: bw + lampW / 2, cy: h / 2 + 14, r: 12, class: 'lamp' }, g); }
      if (nums) el('text', { x: w / 2, y: -8, 'text-anchor': 'middle', class: 'num-t' }, g, c.id.replace(/\D/g, ''));
    } else if (type === 'sock') {
      el('circle', { cx: bw / 2, cy: h / 2, r: 26, class: 'socket' }, g);
      el('text', { x: bw / 2, y: h - 18, 'text-anchor': 'middle', class: 'cab-t small' }, g, 'QF 1');
    } else {
      if (c.id === 'TK-4') { el('rect', { x: 10, y: 22, width: bw - 20, height: 30, rx: 2, class: 'disp' }, g); el('text', { x: bw / 2, y: 44, 'text-anchor': 'middle', class: 'disp-t' }, g, '19.1'); }
      if (c.id === 'VP-3F63A') for (let k = 0; k < 3; k++) { el('rect', { x: 10 + k * (bw - 20) / 3, y: 24, width: (bw - 20) / 3 - 6, height: 26, rx: 2, class: 'disp' }, g); el('text', { x: 10 + k * (bw - 20) / 3 + ((bw - 20) / 3 - 6) / 2, y: 43, 'text-anchor': 'middle', class: 'disp-t s' }, g, '22' + (k === 2 ? '1' : '2')); }
      if (c.id === 'ПЗВ') el('rect', { x: bw / 2 - 8, y: 30, width: 16, height: 12, class: 'test-btn' }, g);
      el('text', { x: bw / 2, y: h - 22, 'text-anchor': 'middle', class: 'cab-t' + (bw < 60 ? ' small' : '') }, g, c.id === 'SWITCH' ? 'SWITCH' : c.id);
    }
  }
  el('title', {}, g, c.id + (c.text ? ' — ' + c.text : c.label && c.label !== c.id ? ' — ' + c.label : ''));
}

function drawDoorItem(p, parent, c, type, x, y) {
  const g = item(p, 'k:' + c.id, el('g', { transform: `translate(${x},${y})` }, parent), 'cab-item');
  const lab = c.label.length > 16 ? c.label.slice(0, 15) + '…' : c.label;
  const sw = Math.max(48, lab.length * 5.6 + 12);
  el('rect', { x: -sw / 2, y: -50, width: sw, height: 20, rx: 2, class: 'sticker' }, g);
  el('text', { x: 0, y: -36, 'text-anchor': 'middle', class: 'sticker-t small' }, g, lab);
  const col = { 'lamp-g': '#22c55e', 'lamp-y': '#f59e0b', 'lamp-r': '#ef4444', 'btn-g': '#16a34a', 'btn-r': '#dc2626' }[type];
  if (type === 'key') { el('circle', { cx: 0, cy: 0, r: 16, class: 'keysw' }, g); el('rect', { x: -3, y: -10, width: 6, height: 20, class: 'keyslot' }, g); }
  else if (type === 'estop') { el('circle', { cx: 0, cy: 0, r: 26, class: 'estop-ring' }, g); el('circle', { cx: 0, cy: 0, r: 20, class: 'estop' }, g); }
  else { el('circle', { cx: 0, cy: 0, r: 17, class: 'bezel' }, g); el('circle', { cx: 0, cy: 0, r: 13, fill: col, class: type.startsWith('lamp') ? 'lens' : 'btn' }, g); }
  el('text', { x: 0, y: 40, 'text-anchor': 'middle', class: 'cab-t small' }, g, c.id);
  el('title', {}, g, c.text);
}

/* =========================================================
   6. Вид «RS-485»
   ========================================================= */
function renderBus(p) {
  const W = p.world;
  const NW = 180, NH = 56, GX = 54;
  const pos = {};
  const main = BUS.main;
  const perRow = 7;
  main.forEach((id, i) => {
    const row = Math.floor(i / perRow), k = i % perRow;
    const col = row % 2 ? perRow - 1 - k : k;
    pos[id] = [col * (NW + GX), 80 + row * 260];
  });
  pos.COMMUTATOR = [pos.MASTER[0], pos.MASTER[1] - 120];
  BUS.rm.forEach(ch => { const [x, y] = pos[ch[0]]; ch.slice(1).forEach((id, k) => pos[id] = [x, y + (k + 1) * 92]); });
  BUS.loose.forEach((id, k) => pos[id] = [k * (NW + GX), 80 + 2 * 260 + 220]);
  const edge = (a, b, cls = '') => {
    const [x1, y1] = pos[a], [x2, y2] = pos[b];
    let d;
    if (y1 === y2) d = x2 > x1 ? `M ${x1 + NW} ${y1 + NH / 2} H ${x2}` : `M ${x1} ${y1 + NH / 2} H ${x2 + NW}`;
    else if (x1 === x2) d = y2 > y1 ? `M ${x1 + NW / 2} ${y1 + NH} V ${y2}` : `M ${x1 + NW / 2} ${y1} V ${y2 + NH}`;
    else d = `M ${x1 + NW / 2} ${y1 + NH} V ${(y1 + NH + y2) / 2} H ${x2 + NW / 2} V ${y2}`;
    el('path', { d, class: 'bus-edge ' + cls, 'marker-end': 'url(#arr)' }, W);
  };
  const defs = el('defs', {}, W);
  const mk = el('marker', { id: 'arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, defs);
  el('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arr' }, mk);
  for (let i = 0; i < main.length - 1; i++) edge(main[i], main[i + 1]);
  BUS.side.forEach(([a, b]) => edge(a, b, 'side'));
  BUS.rm.forEach(ch => { for (let i = 0; i < ch.length - 1; i++) edge(ch[i], ch[i + 1], 'rm'); });
  for (const [id, [x, y]] of Object.entries(pos)) {
    const b = BOARDS[id];
    const g = item(p, 'b:' + id, el('g', { transform: `translate(${x},${y})` }, W), 'bus-node' + (b.excluded ? ' excluded' : '') + (b.type === 'w5500' ? ' w' : ''));
    el('rect', { width: NW, height: NH, rx: 10 }, g);
    el('text', { x: NW / 2, y: 24, 'text-anchor': 'middle', class: 'bn-title' }, g, id);
    el('text', { x: NW / 2, y: 42, 'text-anchor': 'middle', class: 'bn-sub' }, g, b.excluded ? 'поза схемою' : (LOCS[b.loc] ? LOCS[b.loc].name : ''));
  }
  el('text', { x: 0, y: -80, class: 'col-title' }, W, 'Шина RS-485 — основний ланцюг ([ЕС] с.10) і ланцюги робочих місць ([ЕС] с.11)');
  el('text', { x: 0, y: 80 + 2 * 260 + 196, class: 'g-sub' }, W, 'На схемі шини не з\'єднані (верхні поверхи):');
  el('text', { x: 0, y: -56, class: 'g-sub' }, W, BUS.note);
  p.bbox = { x: -30, y: -110, w: perRow * (NW + GX) + 20, h: 2 * 260 + 220 + 200 };
  p.legend = null;
}

/* =========================================================
   7. Рендер панелі, виділення
   ========================================================= */
function renderPane(p) {
  p.view = state.views[p.i];
  p.world.innerHTML = ''; p.reg = new Map();
  p.root.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === p.view));
  ({ plan: renderPlan, boards: renderBoards, cab: renderCab, bus: renderBus })[p.view](p);
  p.root.querySelector('.pane-title').textContent = {
    plan: 'План сортувальника — спрощено, не в масштабі',
    boards: 'Бокси (креслення з документа) і плати · роз\'єми IN зверху, OUT знизу',
    cab: 'Електрична шафа — автомати та що вони живлять',
    bus: 'Порядок підключення RS-485' }[p.view];
  const lg = p.root.querySelector('.pane-legend');
  lg.innerHTML = p.legend ? p.legend.map(([k, t]) => `<span><i style="--c:${KINDS[k].color}" class="lg-${KINDS[k].group}"></i>${t}</span>`).join('') + '<span><i class="lg-dash"></i>припущення</span>' : '';
  lg.style.display = p.legend ? '' : 'none';
  fit(p);
  applyHighlight();
}

function layout() {
  const host = $('#panes');
  host.classList.toggle('split', state.split === 2);
  panes.forEach((p, i) => p.root.style.display = i < state.split ? '' : 'none');
  document.querySelectorAll('[data-split]').forEach(b => b.classList.toggle('on', +b.dataset.split === state.split));
  requestAnimationFrame(() => panes.forEach(p => fit(p)));
}

function applyHighlight() {
  const ref = state.hover || state.sel;
  const rel = ref ? related(ref) : null;
  document.body.classList.toggle('show-labels', state.labels);
  for (const p of panes) {
    p.svg.classList.toggle('has-sel', !!rel);
    for (const [r, els] of p.reg) {
      const on = rel && rel.has(r), prim = r === ref;
      for (const e of els) { e.classList.toggle('rel', !!on); e.classList.toggle('prim', prim); }
    }
  }
}

function bboxOf(p, refs) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const inv = p.world.getScreenCTM && p.world.getScreenCTM();
  for (const r of refs) for (const e of p.reg.get(r) || []) {
    let b; try { b = e.getBBox(); } catch (_) { continue; }
    const m = e.getCTM(), w = p.world.getCTM();
    if (!m || !w) continue;
    const rel = w.inverse().multiply(m);
    const pts = [[b.x, b.y], [b.x + b.width, b.y + b.height]].map(([x, y]) => { const pt = new DOMPoint(x, y).matrixTransform(rel); return [pt.x, pt.y]; });
    for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  }
  return isFinite(x1) ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}
function focusSel(p, force) {
  const ref = state.sel; if (!ref) { if (force) fit(p); return; }
  let refs = related(ref);
  // спершу — сам елемент, якщо його видно в цій панелі
  const b = bboxOf(p, refs); if (!b) return;
  const r = p.svg.getBoundingClientRect(); const ar = (r.width || 1) / (r.height || 1);
  const minW = p.view === 'plan' ? 420 : 900;
  let w = Math.max(b.w + 160, minW), h = Math.max(b.h + 160, minW / ar);
  if (w / h > ar) h = w / ar; else w = h * ar;
  setVB(p, { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h });
}

function select(ref, fromPane) {
  state.sel = ref; state.hover = null;
  applyHighlight(); renderInfo(); writeHash();
  if (ref && state.autofocus) panes.forEach((p, i) => { if (i < state.split && p !== fromPane) focusSel(p); });
}

/* =========================================================
   8. Інформаційна панель
   ========================================================= */
const chip = (ref, text, color) => `<button class="ref" data-ref="${esc(ref)}" style="--c:${color || 'var(--accent)'}">${esc(text || refLabel(ref))}</button>`;
function devPlace(d) {
  const z = d.pos ? zoneOf(d.pos[0]) : null;
  const parts = [];
  if (d.node) parts.push('вузол ' + d.node);
  if (z) parts.push(z);
  return parts.join(' · ');
}
function connRows(c) {
  if (c.dir === 'w') return `<tr><td>Піни</td><td>${c.pins.map(esc).join(' / ')}</td></tr>`;
  const t = c.target, d = t && !t.includes(':') ? DEVICES[t] : null;
  const wiring = d ? (WIRING[d.kind] || (KINDS[d.kind].group === 'drive' ? WIRING.DRIVE : null)) : t ? (c.dir === 'in' ? WIRING.SIG_IN : WIRING.SIG_OUT) : null;
  return c.pins.map(pin => `<tr><td class="mono">${pin}</td><td>${wiring && wiring[pin] ? esc(wiring[pin]) : '<span class="muted">—</span>'}</td></tr>`).join('');
}
function connCard(c) {
  const b = BOARDS[c.board];
  const t = c.target;
  let tgt = '<span class="muted">вільний</span>';
  if (t) {
    if (t.includes(':')) tgt = chip('c:' + t, connTitle(CONNS['c:' + t]), KINDS.SIG.color) + ' <span class="muted">(сигнал між платами)</span>';
    else if (DEVICES[t]) { const d = DEVICES[t]; tgt = chip('d:' + t, d.label, KINDS[d.kind].color) + ` <span class="muted">${esc(KINDS[d.kind].name)}</span>`; }
  }
  const pinNote = c.dir === 'in' ? PINOUT.IN.note : c.dir === 'out' ? PINOUT.OUT.note : '';
  return `
    <div class="card">
      <div class="k">Роз'єм</div>
      <h3>${esc(c.board)} · ${esc(c.label || c.n)}</h3>
      <div class="row">Плата: ${chip('b:' + b.id, b.id)} ${b.aka[0] ? `<span class="muted">(${esc(b.aka[0])})</span>` : ''}</div>
      <div class="row">Де: ${b.loc ? chip('l:' + b.loc, LOCS[b.loc].name) : '—'} <span class="muted">${esc(LOCS[b.loc] ? LOCS[b.loc].side : '')}</span></div>
      <div class="row">Підключено: ${tgt}</div>
      ${t && DEVICES[t] ? devDetails(DEVICES[t], true) : ''}
      <table class="pins"><tr><th>Пін</th><th>Провід</th></tr>${connRows(c)}</table>
      ${c.jumper ? `<div class="row">Джампер: <b class="jmpb jmp-${c.jumper}">${c.jumper}</b></div>` : ''}
      ${pinNote ? `<p class="note">${esc(pinNote)}</p>` : ''}
    </div>`;
}
function devDetails(d, compact) {
  const rows = [];
  const place = devPlace(d);
  if (place) rows.push(`<div class="row">На плані: <b>${esc(place)}</b></div>`);
  if (d.vfd) rows.push(`<div class="row">${KINDS[d.kind].group === 'drive' ? 'Частотник стоїть у' : 'Розташування'}: ${chip('l:' + d.vfd, LOCS[d.vfd].name)}</div>`);
  if (d.alt) rows.push(`<div class="row muted">Інші позначення: ${esc(d.alt)}</div>`);
  if (d.note) rows.push(`<p class="note">${esc(d.note)}</p>`);
  if (d.assumed) rows.push(`<p class="note warn">Припущення — уточнити.</p>`);
  return rows.join('');
}
function devCard(d) {
  const conns = [...(EDGES.get('d:' + d.id) || [])];
  let cs = conns.filter(r => r.startsWith('c:'));
  const chain = conns.filter(r => r.startsWith('d:'));
  // пристрій без прямого роз'єму (сканер) — роз'єм через проміжний модуль
  if (!cs.length) for (const r of chain) cs = cs.concat([...(EDGES.get(r) || [])].filter(x => x.startsWith('c:')));
  return `
    <div class="card">
      <div class="k" style="color:${KINDS[d.kind].color}">${esc(KINDS[d.kind].name)}</div>
      <h3>${esc(d.label)}</h3>
      <div class="row">Підключено до: ${cs.length ? cs.map(r => chip(r, connTitle(CONNS[r]), 'var(--accent)')).join(' ') : '<span class="muted">' + (d.unconnected ? 'порт не вказано' : '—') + '</span>'}</div>
      ${chain.length ? `<div class="row">Через: ${chain.map(r => chip(r, refLabel(r), KINDS[DEVICES[r.slice(2)].kind].color)).join(' ')}</div>` : ''}
      ${conns.some(r => r.startsWith('k:')) ? `<div class="row">Живлення: ${conns.filter(r => r.startsWith('k:')).map(r => chip(r, refLabel(r), '#f97316') + ` <span class="muted">${esc(CAB[r.slice(2)].text || '')}</span>`).join(' ')}</div>` : ''}
      ${devDetails(d)}
      ${cs.length ? `<table class="pins"><tr><th>Пін</th><th>Провід</th></tr>${connRows(CONNS[cs[0]])}</table>` : ''}
    </div>`;
}
function boardCard(b) {
  const rows = Object.values(CONNS).filter(c => c.board === b.id).map(c => {
    const t = c.target;
    const tg = !t ? '<span class="muted">—</span>' : t.includes(':') ? chip('c:' + t, connTitle(CONNS['c:' + t]), KINDS.SIG.color) : chip('d:' + t, DEVICES[t] ? DEVICES[t].label : t, kindColor(t));
    return `<tr><td>${chip(c.ref, c.label || c.n, 'var(--muted)')}</td><td>${c.jumper ? `<span class="jmpb jmp-${c.jumper}">${c.jumper}</span>` : ''}</td><td>${tg}</td></tr>`;
  }).join('');
  const bus = BUS.main.includes(b.id) ? 'основний ланцюг' : BUS.rm.some(ch => ch.includes(b.id)) ? 'ланцюг РМ' : BUS.side.some(s => s.includes(b.id)) ? 'відгалуження від MASTER' : null;
  return `
    <div class="card">
      <div class="k">Плата ${b.type === 'w5500' ? 'CTRL5500 V1 (W5500)' : 'NVG030_V1'}</div>
      <h3>${esc(b.id)}</h3>
      ${b.aka.length ? `<div class="row muted">Також: ${b.aka.map(esc).join(' · ')}</div>` : ''}
      <div class="row">Де: ${b.loc ? chip('l:' + b.loc, LOCS[b.loc].name) : '—'} <span class="muted">${esc(LOCS[b.loc] ? LOCS[b.loc].side : '')}</span></div>
      ${b.role ? `<p>${esc(b.role)}</p>` : ''}
      ${bus ? `<div class="row">RS-485: ${bus}</div>` : ''}
      ${[...(EDGES.get('b:' + b.id) || [])].filter(r => r.startsWith('k:')).map(r => `<div class="row">Живлення: ${chip(r, refLabel(r), '#f97316')} <span class="muted">${esc(CAB[r.slice(2)].text || '')}</span></div>`).join('')}
      ${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
      ${b.excluded ? '<p class="note warn">Поза поточною схемою.</p>' : `<table class="pins conns"><tr><th>Роз'єм</th><th>Дж.</th><th>Підключено</th></tr>${rows}</table>`}
    </div>`;
}
function locCard(id) {
  const L = LOCS[id];
  const bs = boardsByLoc(id), ds = Object.values(DEVICES).filter(d => d.vfd === id);
  const extra = (EXTRA_DRIVES[id] || []);
  return `
    <div class="card">
      <div class="k">Місце</div>
      <h3>${esc(L.name)}</h3>
      <div class="row muted">${esc(L.side)}</div>
      ${bs.length ? `<div class="row">Плати: ${bs.map(b => chip('b:' + b.id, b.id, b.excluded ? 'var(--muted)' : 'var(--accent)')).join(' ')}</div>` : ''}
      ${ds.length ? `<div class="row">${ds.some(d => KINDS[d.kind].group === 'drive') ? 'Частотники' : 'Пристрої'}: ${ds.map(d => chip('d:' + d.id, d.label, KINDS[d.kind].color)).join(' ')}</div>` : ''}
      ${extra.length ? `<div class="row muted">Поза схемою: ${extra.map(esc).join(', ')}</div>` : ''}
    </div>`;
}

function cabCard(c) {
  const feeds = c.feeds.map(r => refExists(r) ? chip(r, refLabel(r), r[0] === 'd' ? KINDS[DEVICES[r.slice(2)].kind].color : 'var(--accent)') : '').join(' ');
  const back = [...(EDGES.get('k:' + c.id) || [])].filter(r => r.startsWith('k:') && !c.feeds.includes(r));
  const sfOf = r => [...(EDGES.get(r) || [])].filter(x => x.startsWith('k:'));
  return `
    <div class="card">
      <div class="k">Електрична шафа${c.row ? ' · ряд ' + c.row : c.door ? ' · двері' : ''}</div>
      <h3>${esc(c.id)}</h3>
      ${c.label && c.label !== c.id ? `<div class="row muted">${esc(c.label)}</div>` : ''}
      ${c.text ? `<p>${esc(c.text)}</p>` : ''}
      ${feeds ? `<div class="row">Живить: ${feeds}</div>` : ''}
      ${back.length ? `<div class="row">Живлення від: ${back.map(r => chip(r, refLabel(r))).join(' ')}</div>` : ''}
      ${c.feeds.filter(r => r[0] === 'd').map(r => { const d = DEVICES[r.slice(2)]; return d.vfd ? `<div class="row muted">${esc(d.label)} — частотник у ${chip('l:' + d.vfd, LOCS[d.vfd].name)}</div>` : ''; }).join('')}
      ${c.excluded ? '<p class="note warn">Верхні поверхи / ліфти — поза поточною схемою.</p>' : ''}
    </div>`;
}

function renderInfo() {
  const ref = state.hover || state.sel;
  const box = $('#info-sel');
  if (!ref) { box.innerHTML = ''; box.hidden = true; $('#info-help').hidden = false; return; }
  const t = ref[0], id = ref.slice(2);
  box.innerHTML = (state.sel && !state.hover ? '<button class="clear" id="clear-sel">✕ зняти виділення</button>' : '') +
    (t === 'c' ? connCard(CONNS[ref]) : t === 'd' ? devCard(DEVICES[id]) : t === 'b' ? boardCard(BOARDS[id]) : t === 'k' ? cabCard(CAB[id]) : locCard(id));
  box.hidden = false; $('#info-help').hidden = true;
  const cl = $('#clear-sel'); if (cl) cl.onclick = () => select(null);
}

/* =========================================================
   9. Пошук
   ========================================================= */
const INDEX = [];
for (const d of Object.values(DEVICES)) INDEX.push({ ref: 'd:' + d.id, t: d.label, s: [d.id, d.alt || '', KINDS[d.kind].short, d.note || ''].join(' '), c: KINDS[d.kind].color });
for (const b of Object.values(BOARDS)) INDEX.push({ ref: 'b:' + b.id, t: b.id, s: b.aka.join(' ') + ' плата', c: 'var(--accent)' });
for (const c of Object.values(CONNS)) INDEX.push({ ref: c.ref, t: connTitle(c), s: (c.target ? targetLabel(c.target) : 'вільний') + ' ' + c.board.replace(' ', ''), c: 'var(--muted)' });
for (const [id, L] of Object.entries(LOCS)) INDEX.push({ ref: 'l:' + id, t: L.name, s: L.side + ' бокс box', c: 'var(--muted)' });
for (const c of Object.values(CAB)) INDEX.push({ ref: 'k:' + c.id, t: c.id, s: [c.label, c.text || '', 'шафа автомат'].join(' '), c: '#f97316' });
const norm = s => s.toLowerCase().replace(/[\s_·.()-]+/g, '');

function setupSearch() {
  const inp = $('#search'), list = $('#search-res');
  let cur = -1, res = [];
  const draw = () => {
    list.innerHTML = res.map((r, i) => `<li data-i="${i}" class="${i === cur ? 'on' : ''}"><i style="--c:${r.c}"></i><b>${esc(r.t)}</b><span>${esc(r.ref[0] === 'c' ? (CONNS[r.ref].target ? targetLabel(CONNS[r.ref].target) : 'вільний') : r.ref[0] === 'd' ? KINDS[DEVICES[r.ref.slice(2)].kind].short : r.ref[0] === 'b' ? 'плата' : r.ref[0] === 'k' ? 'шафа' : 'місце')}</span></li>`).join('');
    list.hidden = !res.length;
  };
  inp.addEventListener('input', () => {
    const q = norm(inp.value);
    if (!q) { res = []; draw(); return; }
    const raw = inp.value.trim().toLowerCase();
    const score = e => { const a = norm(e.t), b = norm(e.s); if (a === q) return 0; if (a.startsWith(q)) return 1; if (e.t.toLowerCase().includes(raw)) return 1.5; if (a.includes(q)) return 2; if (b.includes(q)) return 3; return 9; };
    res = INDEX.map(e => [score(e), e]).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0] || a[1].t.length - b[1].t.length).slice(0, 14).map(x => x[1]);
    cur = res.length ? 0 : -1; draw();
  });
  const pick = i => { if (!res[i]) return; select(res[i].ref); inp.value = ''; res = []; draw(); inp.blur(); };
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { cur = Math.min(res.length - 1, cur + 1); draw(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { cur = Math.max(0, cur - 1); draw(); ev.preventDefault(); }
    else if (ev.key === 'Enter') pick(cur);
    else if (ev.key === 'Escape') { inp.value = ''; res = []; draw(); }
  });
  list.addEventListener('mousedown', ev => { const li = ev.target.closest('li'); if (li) { ev.preventDefault(); pick(+li.dataset.i); } });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  inp.addEventListener('focus', () => { if (res.length) list.hidden = false; });
}

/* =========================================================
   10. Старт
   ========================================================= */
function stats() {
  const used = Object.values(BOARDS).filter(b => !b.excluded);
  const conns = Object.values(CONNS).filter(c => c.target && !BOARDS[c.board].excluded).length;
  const asm = Object.values(DEVICES).filter(d => d.assumed).length;
  $('#stats').innerHTML = `
    <div><b>${used.length}</b><span>плат</span></div>
    <div><b>${Object.keys(DEVICES).length}</b><span>пристроїв</span></div>
    <div><b>${conns}</b><span>зайнятих роз'ємів</span></div>`;
  $('#assumptions').innerHTML = ASSUMPTIONS.map(a => `<li>${esc(a)}</li>`).join('') + `<li>Пристроїв із позначкою «припущення»: ${asm}.</li>`;
  // список плат за місцями
  const groups = {};
  for (const b of Object.values(BOARDS)) (groups[b.loc] = groups[b.loc] || []).push(b);
  $('#board-list').innerHTML = Object.entries(groups).map(([loc, bs]) =>
    `<div class="bl"><span class="muted">${esc(LOCS[loc].name)}</span>${bs.map(b => chip('b:' + b.id, b.id, b.excluded ? 'var(--muted)' : 'var(--accent)')).join('')}</div>`).join('');
}

function init() {
  readHash();
  const host = $('#panes');
  for (let i = 0; i < 2; i++) { const p = makePane(i); panes.push(p); host.appendChild(p.root); }
  document.querySelectorAll('[data-split]').forEach(b => b.onclick = () => { state.split = +b.dataset.split; layout(); writeHash(); });
  $('#opt-labels').onchange = e => { state.labels = e.target.checked; applyHighlight(); };
  $('#opt-focus').onchange = e => { state.autofocus = e.target.checked; };
  $('#opt-labels').checked = state.labels; $('#opt-focus').checked = state.autofocus;
  document.addEventListener('click', ev => {
    const r = ev.target.closest('.side [data-ref], #board-list [data-ref]');
    if (r) select(r.dataset.ref);
  });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && document.activeElement !== $('#search')) select(null); });
  $('#info-toggle').onclick = () => document.body.classList.toggle('info-open');
  setupSearch(); stats();
  panes.forEach(renderPane);
  layout();
  renderInfo();
  if (state.sel) setTimeout(() => panes.forEach(p => focusSel(p)), 60);
  // перерахунок масштабу при зміні розміру панелі
  const ro = new ResizeObserver(entries => {
    for (const en of entries) {
      const p = panes.find(x => x.svg === en.target);
      const { width: w, height: h } = en.contentRect;
      if (!p || w <= 0) continue;
      if (p.size && Math.abs(p.size[0] - w) < 3 && Math.abs(p.size[1] - h) < 3) continue;
      const first = !p.size; p.size = [w, h];
      if (first || !p.vb) { p.prevW = w; state.sel ? focusSel(p, true) : fit(p); continue; }
      // зберігаємо центр і масштаб, підлаштовуємо пропорції
      const vb = p.vb, k = vb.w / (p.prevW || w);
      const nw = w * k, nh = h * k;
      setVB(p, { x: vb.x + vb.w / 2 - nw / 2, y: vb.y + vb.h / 2 - nh / 2, w: nw, h: nh });
      p.prevW = w;
    }
  });
  panes.forEach(p => ro.observe(p.svg));
}
document.addEventListener('DOMContentLoaded', init);
window.GZ = { panes, select, setVB, state }; // для налагодження з консолі
})();
