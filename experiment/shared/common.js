const svgNS = 'http://www.w3.org/2000/svg';
const privateRoot = new URL('../.private/', window.location.href);

export function asset(id, file) {
  return new URL((id ? id + '/' : '') + file, privateRoot).href;
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('私有数据未准备好：请在 experiment 目录运行 python3 tools/prepare_data.py');
  return response.json();
}

export function loadSummary() { return json(asset('', 'summary.json')); }
export function loadRoom(id) { return json(asset(id, 'converted.json')); }
export function loadRawRoom(id) { return json(asset(id, 'source/Room/rooms/room-0.json')); }
export function byId(summary, id) { return summary.scans.find(scan => scan.id === id) || summary.scans[0]; }
export function formatBytes(bytes) { return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB'; }

export function metrics(host, items) {
  host.replaceChildren();
  for (const [value, label] of items) {
    const item = document.createElement('div');
    item.className = 'metric';
    const number = document.createElement('b');
    number.textContent = String(value);
    const caption = document.createElement('span');
    caption.textContent = label;
    item.append(number, caption);
    host.append(item);
  }
}

function svg(tag, attrs, text) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attrs || {})) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

export function drawPlan(host, room) {
  host.replaceChildren();
  const xs = room.polygon.map(point => point[0]);
  const zs = room.polygon.map(point => point[1]);
  const minX = Math.min(...xs) - 0.55, maxX = Math.max(...xs) + 0.55;
  const minZ = Math.min(...zs) - 0.55, maxZ = Math.max(...zs) + 0.55;
  host.setAttribute('viewBox', [minX, -maxZ, maxX - minX, maxZ - minZ].join(' '));
  host.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  host.append(svg('polygon', {
    points: room.polygon.map(([x, z]) => x + ',' + (-z)).join(' '),
    fill: '#38525a', stroke: '#91a7a3', 'stroke-width': 0.012,
  }));
  for (let x = Math.ceil(minX * 2) / 2; x < maxX; x += 0.5) {
    host.append(svg('line', { x1: x, x2: x, y1: -maxZ, y2: -minZ, stroke: '#688088', 'stroke-width': 0.006, opacity: 0.55 }));
  }
  for (let z = Math.ceil(minZ * 2) / 2; z < maxZ; z += 0.5) {
    host.append(svg('line', { x1: minX, x2: maxX, y1: -z, y2: -z, stroke: '#688088', 'stroke-width': 0.006, opacity: 0.55 }));
  }
  room.objects.forEach((item, index) => {
    const [w, , d] = item.size;
    const [x, , z] = item.center;
    const group = svg('g', { transform: 'translate(' + x + ' ' + (-z) + ') rotate(' + (-item.rotY * 180 / Math.PI) + ')' });
    group.append(svg('rect', { x: -w / 2, y: -d / 2, width: w, height: d, fill: '#c28c57', stroke: '#f4d4a5', 'stroke-width': 0.02 }));
    group.append(svg('text', { x: 0, y: 0.045, 'text-anchor': 'middle', fill: '#10272e', 'font-size': Math.min(0.11, w / 6), 'font-weight': '600' }, item.category));
    group.append(svg('title', {}, item.category + ' ' + (index + 1) + '，尺寸 ' + item.size.map(v => v.toFixed(2)).join(' × ') + ' 米'));
    host.append(group);
  });
  room.walls.forEach(wall => {
    host.append(svg('line', { x1: wall.a[0], y1: -wall.a[1], x2: wall.b[0], y2: -wall.b[1], stroke: '#f5f5ec', 'stroke-width': 0.045, 'stroke-linecap': 'square' }));
    for (const opening of wall.openings) {
      const x0 = wall.origin[0] + wall.u[0] * opening.u0;
      const z0 = wall.origin[2] + wall.u[2] * opening.u0;
      const x1 = wall.origin[0] + wall.u[0] * opening.u1;
      const z1 = wall.origin[2] + wall.u[2] * opening.u1;
      host.append(svg('line', { x1: x0, y1: -z0, x2: x1, y2: -z1,
        stroke: opening.kind === 'window' ? '#6de0ce' : '#f0a165', 'stroke-width': 0.065 }));
    }
  });
  host.append(svg('line', { x1: minX + 0.08, y1: -maxZ + 0.12, x2: minX + 0.58, y2: -maxZ + 0.12, stroke: '#f5f5ec', 'stroke-width': 0.025 }));
  host.append(svg('text', { x: minX + 0.08, y: -maxZ + 0.06, fill: '#f5f5ec', 'font-size': 0.11 }, '0.5 m'));
}
