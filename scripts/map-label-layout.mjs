// Runs after document.fonts.ready in the export browser. Font metrics belong
// to that renderer, rather than a character-count approximation in map data.
// The final DOM is serialized into the static HTML as well as the PNG.
export function layoutMapLabels({ repair = true, padding = 4 } = {}) {
  const svg = document.querySelector('.japan-map-plate svg');
  if (!svg) return { labels: 0, moved: [], collisions: [], clipped: [] };
  const inverse = svg.getScreenCTM().inverse();
  const toLocal = (x, y) => new DOMPoint(x, y).matrixTransform(inverse);
  const rect = element => {
    const r = element.getBoundingClientRect(), a = toLocal(r.left, r.top), b = toLocal(r.right, r.bottom);
    return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  };
  const overlap = (a, b) => a.x < b.x + b.width + padding && a.x + a.width + padding > b.x &&
    a.y < b.y + b.height + padding && a.y + a.height + padding > b.y;
  // SVG text uses a 4px paper-colored stroke; reserve its 2px outer half.
  const canvas = rect(svg), safe = 2;
  const within = b => b.x >= canvas.x + safe && b.y >= canvas.y + safe &&
    b.x + b.width <= canvas.x + canvas.width - safe && b.y + b.height <= canvas.y + canvas.height - safe;
  const labels = [...svg.querySelectorAll('text.jp-label, text.jp-inset-title, text.map-source')]
    .map(element => ({ element, name: element.textContent, box: rect(element),
      movable: element.matches('.jp-label:not(.jp-edge-label)'), edge: element.matches('.jp-edge-label') }));
  const caption = [...document.querySelectorAll('.map-caption > span, .map-caption small')]
    .map(element => ({ name: '地图标题', box: rect(element) }));
  const nodes = [...svg.querySelectorAll('.jp-place, .jp-edge-dot')]
    .map(element => ({ element, name: element.querySelector('title')?.textContent || '节点', box: rect(element) }));
  const obstacles = [...caption, ...nodes];
  const conflicts = (box, self) => [...labels.filter(p => p !== self), ...obstacles]
    .some(p => overlap(box, p.box));
  const moved = [];
  // Long overseas names may need a few extra pixels of inward rail space.
  // Move that entire display endpoint together, including every dashed path
  // touching it; never leave a gap between the path and its edge dot.
  if (repair) for (const label of labels.filter(p => p.edge && !within(p.box))) {
    const element = label.element, leader = element.previousElementSibling;
    const dot = leader?.previousElementSibling;
    if (!leader?.matches('.jp-leader') || !dot?.matches('.jp-edge-dot')) continue;
    const shift = label.box.x < canvas.x + safe ? canvas.x + safe + .5 - label.box.x :
      canvas.x + canvas.width - safe - .5 - label.box.x - label.box.width;
    const x = Number(dot.getAttribute('cx')), y = Number(dot.getAttribute('cy')), nextX = x + shift;
    for (const path of svg.querySelectorAll('path[data-edge]')) {
      const end = path.getPointAtLength(path.getTotalLength());
      if (Math.hypot(end.x - x, end.y - y) < .15)
        path.setAttribute('d', path.getAttribute('d').replace(/[-+\d.eE]+[,\s]+[-+\d.eE]+\s*$/, `${nextX},${y}`));
    }
    dot.setAttribute('cx', nextX.toFixed(2));
    element.setAttribute('x', (Number(element.getAttribute('x')) + shift).toFixed(2));
    const tx = Number(element.getAttribute('x'));
    leader.setAttribute('d', `M${nextX},${y}L${tx},${y}`);
    label.box = rect(element);
    const obstacle = nodes.find(p => p.element === dot); if (obstacle) obstacle.box = rect(dot);
    moved.push({ name: label.name, dx: Number(shift.toFixed(2)), dy: 0, kind: 'edge-rail' });
  }
  // Inland labels can move around a node. Edge text only moves horizontally
  // outward, preserving the edge dots, dashed paths and north-to-south order.
  if (repair) for (const label of [...labels.filter(p => p.movable), ...labels.filter(p => p.edge)]) {
    if (within(label.box) && !conflicts(label.box, label)) continue;
    const element = label.element, x = Number(element.getAttribute('x')), y = Number(element.getAttribute('y'));
    const leader = element.previousElementSibling?.matches('path.jp-leader') ? element.previousElementSibling : null;
    const node = leader ? leader.getPointAtLength(0) : { x, y };
    const bearing = Math.atan2(y - node.y, x - node.x);
    let candidate;
    // Prefer the original outward direction, then nearby directions; increase
    // displacement only when the actual text box still collides. No labels
    // disappear, and geographic nodes never move.
    for (let distance = 12; distance <= 240 && !candidate; distance += 12) {
      const options = [];
      for (let step = 0; step < (label.edge ? 1 : 24); step++) {
        const angle = bearing + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * Math.PI / 12;
        const dx = label.edge ? (element.getAttribute('text-anchor') === 'end' ? -distance : distance) : Math.cos(angle) * distance;
        const dy = label.edge ? 0 : Math.sin(angle) * distance;
        const box = { ...label.box, x: label.box.x + dx, y: label.box.y + dy };
        if (within(box) && !conflicts(box, label)) options.push({ box, dx, dy, step });
      }
      candidate = options.sort((a, b) => a.step - b.step)[0];
    }
    if (!candidate) continue; // The final audit will reject this export.
    element.setAttribute('x', (x + candidate.dx).toFixed(2));
    element.setAttribute('y', (y + candidate.dy).toFixed(2));
    element.setAttribute('data-label-adjusted', 'true');
    // End at the nearest point outside the measured text rectangle, so the
    // line connects the true node without running through its own caption.
    const box = candidate.box;
    const end = { x: Math.min(box.x + box.width, Math.max(box.x, node.x)),
      y: Math.min(box.y + box.height, Math.max(box.y, node.y)) };
    const dx = node.x - end.x, dy = node.y - end.y, length = Math.hypot(dx, dy) || 1;
    end.x += dx / length * padding; end.y += dy / length * padding;
    if (leader) {
      leader.setAttribute('d', `M${node.x},${node.y}L${end.x.toFixed(2)},${end.y.toFixed(2)}`);
      leader.setAttribute('data-label-adjusted', 'true');
    }
    label.box = rect(element);
    moved.push({ name: label.name, dx: Number(candidate.dx.toFixed(2)), dy: Number(candidate.dy.toFixed(2)) });
  }
  // Audit every label, including fixed overseas/inset labels and captions.
  // Node contacts are audited too; own leader endpoints are not obstacles.
  const collisions = [];
  for (let i = 0; i < labels.length; i++) {
    const a = labels[i];
    for (const b of [...labels.slice(i + 1), ...obstacles])
      if (overlap(a.box, b.box)) collisions.push([a.name, b.name]);
  }
  return { labels: labels.length, moved, collisions,
    clipped: labels.filter(p => !within(p.box)).map(p => p.name) };
}
