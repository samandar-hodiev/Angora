/**
 * Flower backgrounds for the learner app: roses, water lilies, sakura, tulips and chamomile.
 *
 * Like the gradient presets they are drawn here, not downloaded — each scene is an SVG built
 * once at module load and used as a `data:` URL, so there is no request, nothing to store and
 * nothing the server can change. Placement comes from a seeded generator, so a scene looks the
 * same on every load and every device.
 *
 * Each scene is a full picture rather than a translucent wash, so it carries the tone text over
 * it should follow, the way a photo does.
 */

const W = 1600;
const H = 1000;

/** Deterministic random numbers: the same seed always draws the same scene. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (value: number) => Math.round(value * 10) / 10;

/** A petal growing upwards from the origin. */
function petalPath(length: number, width: number) {
  const l = length;
  const w = width / 2;
  return `M0 0C${n(w)} ${n(-l * 0.3)} ${n(w * 0.95)} ${n(-l * 0.85)} 0 ${n(-l)}C${n(-w * 0.95)} ${n(-l * 0.85)} ${n(-w)} ${n(-l * 0.3)} 0 0Z`;
}

/** A sakura petal: rounded, with the small notch at its tip. */
function notchedPetalPath(length: number, width: number) {
  const l = length;
  const w = width / 2;
  return `M0 0C${n(w * 1.1)} ${n(-l * 0.3)} ${n(w * 1.05)} ${n(-l * 0.95)} ${n(w * 0.3)} ${n(-l)}L0 ${n(-l * 0.86)}L${n(-w * 0.3)} ${n(-l)}C${n(-w * 1.05)} ${n(-l * 0.95)} ${n(-w * 1.1)} ${n(-l * 0.3)} 0 0Z`;
}

/** A gradient running along a petal, from its base to its tip. */
function petalGradient(id: string, base: string, tip: string) {
  return `<linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${tip}"/></linearGradient>`;
}

function svg(defs: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice"><defs>${defs}</defs>${body}</svg>`;
}

function dataUrl(markup: string) {
  return `url("data:image/svg+xml,${encodeURIComponent(markup)}")`;
}

function leaf(x: number, y: number, length: number, angle: number, fill: string, vein: string) {
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(angle)})"><path d="${petalPath(length, length * 0.42)}" fill="${fill}"/><path d="M0 0L0 ${n(-length * 0.92)}" stroke="${vein}" stroke-width="2" fill="none" opacity="0.55"/></g>`;
}

// ---- Roses -----------------------------------------------------------------------------------

function rose(x: number, y: number, r: number, turn: number, gradient: string, heart: string) {
  const rings = [
    { count: 5, length: r, width: r * 1.05, offset: 0 },
    { count: 5, length: r * 0.8, width: r * 0.9, offset: 36 },
    { count: 4, length: r * 0.58, width: r * 0.72, offset: 12 },
    { count: 3, length: r * 0.38, width: r * 0.5, offset: 64 },
  ];
  let petals = "";
  for (const ring of rings) {
    const d = petalPath(ring.length, ring.width);
    for (let i = 0; i < ring.count; i++) {
      const angle = ring.offset + (360 / ring.count) * i;
      petals += `<path d="${d}" transform="rotate(${n(angle)})" fill="url(#${gradient})" stroke="${heart}" stroke-opacity="0.35" stroke-width="1.5"/>`;
    }
  }
  const s = r * 0.16;
  const swirl = `<path d="M${n(-s)} 0C${n(-s)} ${n(-s * 1.2)} ${n(s * 1.2)} ${n(-s * 1.1)} ${n(s)} ${n(s * 0.4)}C${n(s * 0.8)} ${n(s * 1.3)} ${n(-s * 0.6)} ${n(s * 1.1)} ${n(-s * 0.4)} ${n(s * 0.2)}" stroke="${heart}" stroke-width="${n(Math.max(2, r * 0.05))}" fill="none" stroke-linecap="round"/>`;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(turn)})">${petals}<circle r="${n(r * 0.18)}" fill="${heart}" opacity="0.55"/>${swirl}</g>`;
}

function rosesScene() {
  const random = rng(7);
  const defs =
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b0d19"/><stop offset="0.55" stop-color="#3b1224"/><stop offset="1" stop-color="#1c0911"/></linearGradient>` +
    `<radialGradient id="glow" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="#5a1a33" stop-opacity="0.55"/><stop offset="1" stop-color="#5a1a33" stop-opacity="0"/></radialGradient>` +
    petalGradient("red", "#6d0f2a", "#e2485f") +
    petalGradient("blush", "#9e2d4b", "#f7a3b1") +
    petalGradient("cream", "#c06b76", "#fde3dc") +
    `<linearGradient id="leaf" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#1b3a26"/><stop offset="1" stop-color="#3c7048"/></linearGradient>`;

  const clusters: [number, number, number][] = [
    [120, 110, 1],
    [1500, 900, 1.15],
    [1490, 120, 0.7],
    [110, 900, 0.75],
    [820, 990, 0.55],
    [800, 10, 0.5],
  ];
  const palettes = ["red", "blush", "cream"];
  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="${H}" fill="url(#glow)"/>`;
  let flowers = "";
  for (const [cx, cy, scale] of clusters) {
    for (let i = 0; i < 6; i++) {
      const a = random() * Math.PI * 2;
      const d = (60 + random() * 120) * scale;
      body += leaf(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (70 + random() * 50) * scale, random() * 360, "url(#leaf)", "#0f2617");
    }
    const count = scale > 0.9 ? 4 : 3;
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const d = i === 0 ? 0 : (70 + random() * 60) * scale;
      const palette = palettes[Math.floor(random() * palettes.length)] ?? "red";
      flowers += rose(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (52 + random() * 34) * scale * (i === 0 ? 1.25 : 1), random() * 360, palette, "#4a0a1d");
    }
  }
  // A few loose petals drifting across the middle.
  for (let i = 0; i < 16; i++) {
    const palette = palettes[i % palettes.length] ?? "red";
    flowers += `<path d="${petalPath(22 + random() * 14, 20 + random() * 10)}" transform="translate(${n(250 + random() * 1100)} ${n(150 + random() * 700)}) rotate(${n(random() * 360)})" fill="url(#${palette})" opacity="${n(0.35 + random() * 0.35)}"/>`;
  }
  return svg(defs, body + flowers);
}

// ---- Water lilies ----------------------------------------------------------------------------

function lilyPad(x: number, y: number, r: number, turn: number) {
  const notch = 0.32;
  const ax = Math.cos(-notch / 2) * r;
  const ay = Math.sin(-notch / 2) * r;
  let veins = "";
  for (let i = 1; i < 9; i++) {
    const a = notch / 2 + ((Math.PI * 2 - notch) / 9) * i;
    veins += `<path d="M0 0L${n(Math.cos(a) * r * 0.92)} ${n(Math.sin(a) * r * 0.92)}"/>`;
  }
  return `<g transform="translate(${n(x)} ${n(y)}) scale(1 0.62) rotate(${n(turn)})"><path d="M0 0L${n(ax)} ${n(ay)}A${n(r)} ${n(r)} 0 1 0 ${n(ax)} ${n(-ay)}Z" fill="url(#pad)" stroke="#0e3b28" stroke-width="2"/><g stroke="#57a46c" stroke-opacity="0.35" stroke-width="2">${veins}</g></g>`;
}

function waterLily(x: number, y: number, r: number, turn: number) {
  const outer = petalPath(r, r * 0.42);
  const inner = petalPath(r * 0.72, r * 0.34);
  let petals = "";
  for (let i = 0; i < 12; i++) petals += `<path d="${outer}" transform="rotate(${n(i * 30)})" fill="url(#lily)" stroke="#c45d8a" stroke-opacity="0.4" stroke-width="1.2"/>`;
  for (let i = 0; i < 9; i++) petals += `<path d="${inner}" transform="rotate(${n(i * 40 + 15)})" fill="url(#lilyInner)" stroke="#d27aa0" stroke-opacity="0.35" stroke-width="1"/>`;
  let stamens = "";
  for (let i = 0; i < 14; i++) {
    const a = (Math.PI * 2 * i) / 14;
    stamens += `<circle cx="${n(Math.cos(a) * r * 0.16)}" cy="${n(Math.sin(a) * r * 0.16)}" r="${n(r * 0.035)}" fill="#f0a91e"/>`;
  }
  return `<g transform="translate(${n(x)} ${n(y)}) scale(1 0.6) rotate(${n(turn)})">${petals}<circle r="${n(r * 0.2)}" fill="#f7d34a"/>${stamens}</g>`;
}

function waterLilyScene() {
  const random = rng(11);
  const defs =
    `<radialGradient id="bg" cx="0.5" cy="0.45" r="0.8"><stop offset="0" stop-color="#145059"/><stop offset="0.6" stop-color="#0c3640"/><stop offset="1" stop-color="#061c23"/></radialGradient>` +
    `<linearGradient id="pad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3e8f58"/><stop offset="1" stop-color="#1d5c38"/></linearGradient>` +
    petalGradient("lily", "#e07aa6", "#fff0f6") +
    petalGradient("lilyInner", "#f2a6c5", "#ffffff");
  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  for (let i = 0; i < 14; i++) {
    const x = random() * W;
    const y = random() * H;
    const r = 40 + random() * 140;
    body += `<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(r)}" ry="${n(r * 0.32)}" fill="none" stroke="#ffffff" stroke-opacity="${n(0.04 + random() * 0.05)}" stroke-width="2"/>`;
  }
  const pads: [number, number, number, boolean][] = [
    [170, 170, 120, true],
    [360, 90, 70, false],
    [1430, 830, 130, true],
    [1250, 940, 80, false],
    [1460, 150, 90, true],
    [150, 860, 100, true],
    [360, 950, 60, false],
    [800, 960, 70, true],
    [1180, 60, 55, false],
  ];
  let flowers = "";
  for (const [x, y, r, bloom] of pads) {
    body += lilyPad(x, y, r, random() * 360);
    if (bloom) flowers += waterLily(x + (random() - 0.5) * r * 0.4, y - r * 0.15, r * 0.62, random() * 30);
  }
  return svg(defs, body + flowers);
}

// ---- Sakura ----------------------------------------------------------------------------------

function blossom(x: number, y: number, r: number, turn: number) {
  const d = notchedPetalPath(r, r * 0.95);
  let petals = "";
  for (let i = 0; i < 5; i++) petals += `<path d="${d}" transform="rotate(${i * 72})" fill="url(#sakura)" stroke="#e48aa5" stroke-opacity="0.45" stroke-width="1"/>`;
  let stamens = "";
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8 + 0.2;
    const ex = Math.cos(a) * r * 0.42;
    const ey = Math.sin(a) * r * 0.42;
    stamens += `<path d="M0 0L${n(ex)} ${n(ey)}" stroke="#c2185b" stroke-width="1.2" opacity="0.7"/><circle cx="${n(ex)}" cy="${n(ey)}" r="${n(r * 0.06)}" fill="#f6c453"/>`;
  }
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(turn)})">${petals}<circle r="${n(r * 0.16)}" fill="#e7718f"/>${stamens}</g>`;
}

function sakuraScene() {
  const random = rng(23);
  const defs =
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fdf3f6"/><stop offset="0.5" stop-color="#f9e2ea"/><stop offset="1" stop-color="#fcf0f2"/></linearGradient>` +
    petalGradient("sakura", "#f39ab4", "#ffeef3");
  // Branches as smooth curves, each with the points blossoms sit along.
  const branches: { d: string; width: number; points: [number, number][] }[] = [
    { d: "M-40 60C180 90 330 210 560 230S880 200 1010 120", width: 16, points: [[120, 80], [260, 140], [400, 200], [560, 230], [700, 225], [850, 190], [990, 130]] },
    { d: "M300 175C330 260 300 330 360 400", width: 8, points: [[330, 260], [345, 330], [360, 400]] },
    { d: "M720 225C760 290 840 310 880 360", width: 7, points: [[780, 300], [880, 360]] },
    { d: "M1660 930C1460 900 1340 820 1180 830S960 900 860 980", width: 15, points: [[1560, 915], [1430, 875], [1300, 830], [1180, 830], [1050, 870], [930, 935]] },
    { d: "M1360 845C1340 760 1380 700 1350 630", width: 7, points: [[1355, 760], [1360, 690], [1350, 630]] },
    { d: "M1640 80C1560 120 1520 190 1450 210", width: 8, points: [[1560, 125], [1500, 180], [1450, 210]] },
  ];
  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  let flowers = "";
  for (const branch of branches) {
    body += `<path d="${branch.d}" stroke="#5b3a3a" stroke-width="${branch.width}" fill="none" stroke-linecap="round"/>`;
    for (const [x, y] of branch.points) {
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i++) {
        flowers += blossom(x + (random() - 0.5) * 70, y + (random() - 0.5) * 60, 20 + random() * 16, random() * 72);
      }
      if (random() > 0.5) flowers += `<circle cx="${n(x + 20)}" cy="${n(y - 22)}" r="7" fill="#e98aa4"/>`;
    }
  }
  // Petals falling across the open middle.
  for (let i = 0; i < 26; i++) {
    flowers += `<path d="${notchedPetalPath(14 + random() * 8, 12 + random() * 6)}" transform="translate(${n(200 + random() * 1200)} ${n(260 + random() * 560)}) rotate(${n(random() * 360)})" fill="url(#sakura)" opacity="${n(0.45 + random() * 0.4)}"/>`;
  }
  return svg(defs, body + flowers);
}

// ---- Tulips ----------------------------------------------------------------------------------

function tulip(x: number, base: number, height: number, size: number, lean: number, colour: string) {
  const headX = x + lean;
  const headY = base - height;
  const w = size * 0.5;
  const h = size;
  const stem = `<path d="M${n(x)} ${n(base)}Q${n(x + lean * 0.2)} ${n(base - height * 0.55)} ${n(headX)} ${n(headY)}" stroke="#3f7d43" stroke-width="${n(size * 0.09)}" fill="none" stroke-linecap="round"/>`;
  const side = lean > 0 ? -1 : 1;
  const blade = `<path d="M${n(x)} ${n(base)}C${n(x + side * size * 0.9)} ${n(base - height * 0.35)} ${n(x + side * size * 0.7)} ${n(base - height * 0.6)} ${n(x + side * size * 0.25)} ${n(base - height * 0.72)}C${n(x + side * size * 0.3)} ${n(base - height * 0.45)} ${n(x + side * size * 0.15)} ${n(base - height * 0.2)} ${n(x)} ${n(base)}Z" fill="url(#blade)"/>`;
  const cup = `M${n(-w)} 0C${n(-w * 1.05)} ${n(-h * 0.55)} ${n(-w * 0.75)} ${n(-h * 0.95)} ${n(-w * 0.35)} ${n(-h * 1.05)}L0 ${n(-h * 0.78)}L${n(w * 0.35)} ${n(-h * 1.05)}C${n(w * 0.75)} ${n(-h * 0.95)} ${n(w * 1.05)} ${n(-h * 0.55)} ${n(w)} 0C${n(w * 0.6)} ${n(h * 0.35)} ${n(-w * 0.6)} ${n(h * 0.35)} ${n(-w)} 0Z`;
  const front = `M${n(-w * 0.55)} ${n(h * 0.12)}C${n(-w * 0.7)} ${n(-h * 0.4)} ${n(-w * 0.3)} ${n(-h * 0.95)} 0 ${n(-h * 1.1)}C${n(w * 0.3)} ${n(-h * 0.95)} ${n(w * 0.7)} ${n(-h * 0.4)} ${n(w * 0.55)} ${n(h * 0.12)}C${n(w * 0.3)} ${n(h * 0.25)} ${n(-w * 0.3)} ${n(h * 0.25)} ${n(-w * 0.55)} ${n(h * 0.12)}Z`;
  const head = `<g transform="translate(${n(headX)} ${n(headY + h * 0.2)}) rotate(${n(lean * 0.12)})"><path d="${cup}" fill="url(#${colour})"/><path d="${front}" fill="url(#${colour}Front)" opacity="0.95"/></g>`;
  return blade + stem + head;
}

function tulipsScene() {
  const random = rng(31);
  const colours: [string, string, string][] = [
    ["red", "#b3122d", "#f0566a"],
    ["pink", "#d9567f", "#fbb6c8"],
    ["yellow", "#e0a019", "#fde58a"],
    ["orange", "#d9541c", "#ffae6b"],
    ["violet", "#7b3fa0", "#cfa2ee"],
  ];
  let defs =
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff8ef"/><stop offset="0.65" stop-color="#fdeadf"/><stop offset="1" stop-color="#f6dccd"/></linearGradient>` +
    `<linearGradient id="blade" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#2f6a35"/><stop offset="1" stop-color="#7fb36f"/></linearGradient>`;
  for (const [id, deep, light] of colours) {
    defs += `<linearGradient id="${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="${deep}"/><stop offset="1" stop-color="${light}"/></linearGradient>`;
    defs += `<linearGradient id="${id}Front" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${deep}"/><stop offset="0.6" stop-color="${light}"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.9"/></linearGradient>`;
  }
  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  // Two rows: a paler one behind for depth, then the main row along the bottom edge.
  const rows: { count: number; base: number; height: [number, number]; size: [number, number]; opacity: number }[] = [
    { count: 16, base: H + 20, height: [260, 420], size: [46, 62], opacity: 0.45 },
    { count: 13, base: H + 30, height: [150, 300], size: [62, 84], opacity: 1 },
  ];
  for (const row of rows) {
    let group = "";
    for (let i = 0; i < row.count; i++) {
      const x = (W / row.count) * (i + 0.5) + (random() - 0.5) * 60;
      const height = row.height[0] + random() * (row.height[1] - row.height[0]);
      const size = row.size[0] + random() * (row.size[1] - row.size[0]);
      const colour = colours[Math.floor(random() * colours.length)]?.[0] ?? "red";
      group += tulip(x, row.base, height, size, (random() - 0.5) * 70, colour);
    }
    body += `<g opacity="${row.opacity}">${group}</g>`;
  }
  return svg(defs, body);
}

// ---- Chamomile -------------------------------------------------------------------------------

function daisy(x: number, y: number, r: number, tilt: number, turn: number) {
  const d = petalPath(r, r * 0.24);
  let petals = "";
  for (let i = 0; i < 22; i++) petals += `<path d="${d}" transform="rotate(${n(i * (360 / 22))})" fill="url(#petal)" stroke="#d9dccf" stroke-width="0.8"/>`;
  return `<g transform="translate(${n(x)} ${n(y)}) rotate(${n(turn)}) scale(1 ${n(tilt)})">${petals}<circle r="${n(r * 0.3)}" fill="url(#heart)"/><circle r="${n(r * 0.3)}" fill="none" stroke="#c98a0c" stroke-width="1.5" opacity="0.5"/></g>`;
}

function chamomileScene() {
  const random = rng(43);
  const defs =
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1f7ea"/><stop offset="0.5" stop-color="#e2eed4"/><stop offset="1" stop-color="#f4f8ec"/></linearGradient>` +
    petalGradient("petal", "#eef0e6", "#ffffff") +
    `<radialGradient id="heart" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#fde27a"/><stop offset="1" stop-color="#e29b12"/></radialGradient>`;
  let body = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  let flowers = "";
  // Grass and stems rising from the bottom edge, with heads on the taller ones.
  for (let i = 0; i < 70; i++) {
    const x = random() * W;
    const height = 80 + random() * 260;
    const lean = (random() - 0.5) * 80;
    body += `<path d="M${n(x)} ${H + 10}Q${n(x + lean * 0.3)} ${n(H - height * 0.5)} ${n(x + lean)} ${n(H - height)}" stroke="${random() > 0.5 ? "#7fa95f" : "#5f8f48"}" stroke-width="${n(2 + random() * 3)}" fill="none" stroke-linecap="round" opacity="${n(0.5 + random() * 0.5)}"/>`;
    if (height > 200 && random() > 0.35) flowers += daisy(x + lean, H - height, 24 + random() * 18, 0.45 + random() * 0.55, (random() - 0.5) * 40);
  }
  // A few flowers spilling in from the top corners.
  const corners: [number, number][] = [
    [90, 80],
    [210, 40],
    [60, 230],
    [1520, 90],
    [1400, 40],
    [1560, 250],
  ];
  for (const [x, y] of corners) flowers += daisy(x + (random() - 0.5) * 40, y, 34 + random() * 22, 0.8 + random() * 0.2, random() * 30);
  return svg(defs, body + flowers);
}

export const flowerPresets = [
  { id: "roses", label: "Roses", tone: "dark", image: dataUrl(rosesScene()) },
  { id: "water-lily", label: "Water lily", tone: "dark", image: dataUrl(waterLilyScene()) },
  { id: "sakura", label: "Sakura", tone: "light", image: dataUrl(sakuraScene()) },
  { id: "tulips", label: "Tulips", tone: "light", image: dataUrl(tulipsScene()) },
  { id: "chamomile", label: "Chamomile", tone: "light", image: dataUrl(chamomileScene()) },
] as const;
