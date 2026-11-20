import { W, H, PLAYER_COLORS, cellX, cellY } from './sim.js';

const SIDE_NAMES = ['E', 'S', 'W', 'N'];
export const sideLabel = (side) => SIDE_NAMES[side & 3] || '?';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function tracePath(ctx, points) {
  ctx.beginPath();
  if (points.length === 1) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[0].x + 0.01, points[0].y);
    return;
  }
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
  }
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
}

export class ArenaRenderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.states = [];
    this.roster = new Map();
    this.myId = null;
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '#ff4d6d';
    this.reduced =
      opts.reducedMotion || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    this.lastFrame = 0;
    this.vw = 0;
    this.vh = 0;
    this.cell = 20;
    this.ox = 0;
    this.oy = 0;
    this.bw = 0;
    this.bh = 0;
    this.stars = [];
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 110; i++) {
      this.stars.push({
        x: rand(),
        y: rand(),
        r: 0.3 + rand() * 1.4,
        phase: rand() * Math.PI * 2,
        speed: 0.2 + rand() * 1.1,
        tint: rand() < 0.2 ? '#ff9db6' : rand() < 0.5 ? '#8ff7ff' : '#ffffff'
      });
    }
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setMyId(id) {
    this.myId = id;
  }

  setRoster(roster) {
    this.roster = roster;
  }

  reset() {
    this.states = [];
    this.particles = [];
    this.shake = 0;
    this.flash = 0;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.dpr = dpr;
    this.vw = vw;
    this.vh = vh;
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);
    this.canvas.style.width = `${vw}px`;
    this.canvas.style.height = `${vh}px`;
    const wide = vw >= 1060;
    const reserve = wide ? 300 : 0;
    const leftPad = vw < 560 ? 10 : 20;
    const topPad = vw < 700 ? 62 : 82;
    const bottomPad = vw < 700 ? 22 : 36;
    const availW = Math.max(200, vw - leftPad - reserve - (wide ? 24 : 10));
    const availH = Math.max(160, vh - topPad - bottomPad);
    const cell = Math.max(6, Math.min(availW / W, availH / H));
    this.cell = cell;
    this.bw = cell * W;
    this.bh = cell * H;
    this.ox = leftPad + (availW - this.bw) / 2;
    this.oy = topPad + (availH - this.bh) / 2;
  }

  pushState(state) {
    const previous = this.states.length ? this.states[this.states.length - 1].s : null;
    const at = performance.now();
    this.states.push({ s: state, at });
    if (this.states.length > 14) this.states.shift();
    if (previous) this.diff(previous, state);
  }

  diff(prev, next) {
    if (!prev || !next) return;
    const prevActors = new Map((prev.actors || []).map((a) => [a.id, a]));
    const nextActors = new Map((next.actors || []).map((a) => [a.id, a]));
    if (prev.phase === 'round' || prev.phase === 'over') {
      if (next.phase !== 'round' && next.phase !== 'over') return;
      for (const actor of prev.actors || []) {
        if (!actor.alive) continue;
        const now = nextActors.get(actor.id);
        if (now && now.alive) continue;
        const color = PLAYER_COLORS[actor.color % PLAYER_COLORS.length];
        for (let i = 0; i < actor.body.length && i < 26; i += 2) {
          this.burst(actor.body[i], color, 3, 3.5, 900);
        }
        if (actor.id === this.myId) {
          this.shake = Math.max(this.shake, 14);
          this.flash = Math.max(this.flash, 0.6);
          this.flashColor = '#ff4d6d';
        }
      }
    }

    if (prev.phase === 'round' && next.phase === 'round') {
      const newPickups = new Set((next.pickups || []).map((p) => `${p.type}${p.cell}`));
      for (const pickup of prev.pickups || []) {
        if (newPickups.has(`${pickup.type}${pickup.cell}`)) continue;
        const color =
          pickup.type === 'g'
            ? '#ffd25d'
            : pickup.type === 'p'
              ? '#5df2ff'
              : pickup.type === 'q'
                ? '#ff8a3d'
                : '#8dffd2';
        this.burst(pickup.cell, color, pickup.type === 'f' ? 5 : 12, 3.2, 700);
      }
    }

    if (prev.bounds && next.bounds) {
      const b = next.bounds;
      const o = prev.bounds;
      if (b.x0 !== o.x0 || b.y0 !== o.y0 || b.x1 !== o.x1 || b.y1 !== o.y1) {
        this.shake = Math.max(this.shake, this.reduced ? 0 : 4);
        for (let i = 0; i < 18; i++) {
          let x;
          let y;
          if (b.x1 !== o.x1) {
            x = b.x1 + 1;
            y = b.y0 + Math.random() * (b.y1 - b.y0 + 1);
          } else if (b.x0 !== o.x0) {
            x = b.x0 - 1;
            y = b.y0 + Math.random() * (b.y1 - b.y0 + 1);
          } else if (b.y1 !== o.y1) {
            x = b.x0 + Math.random() * (b.x1 - b.x0 + 1);
            y = b.y1 + 1;
          } else {
            x = b.x0 + Math.random() * (b.x1 - b.x0 + 1);
            y = b.y0 - 1;
          }
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          this.burstAt(x, y, '#ff4d6d', 2, 3, 650);
        }
      }
    }
  }

  burst(cell, color, count, speed = 3, life = 700) {
    this.burstAt(cellX(cell) + 0.5, cellY(cell) + 0.5, color, count, speed, life);
  }

  burstAt(x, y, color, count, speed = 3, life = 700) {
    if (this.reduced) count = Math.min(count, 2);
    const total = this.particles.length + count;
    if (total > 320) this.particles.splice(0, total - 320);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = (0.4 + Math.random() * 0.8) * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: life * (0.6 + Math.random() * 0.7),
        maxLife: life,
        size: 0.06 + Math.random() * 0.1,
        color
      });
    }
  }

  updateParticles(dt) {
    const seconds = dt / 1000;
    for (const particle of this.particles) {
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
      particle.life -= dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
    this.shake *= Math.exp(-dt / 150);
    if (this.shake < 0.2) this.shake = 0;
    this.flash *= Math.exp(-dt / 180);
    if (this.flash < 0.01) this.flash = 0;
  }

  pickPair(now) {
    const states = this.states;
    if (!states.length) return null;
    const target = now - 75;
    let index = states.length - 1;
    while (index > 0 && states[index].at > target) index--;
    const prev = states[index];
    const next = states[index + 1] || prev;
    let progress = 1;
    if (next !== prev && prev.s.phase === next.s.phase && next.at > prev.at) {
      progress = clamp((target - prev.at) / (next.at - prev.at), 0, 1);
    }
    return { prev, next, progress, state: next.s };
  }

  nameOf(id) {
    const entry = this.roster.get(id);
    if (entry && entry.name) return String(entry.name);
    return id < 0 ? 'BOT' : 'SERPENT';
  }

  loop(now) {
    const dt = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.updateParticles(dt);
    this.draw(now);
    requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx;
    const dpr = this.dpr || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);
    this.drawBackdrop(now);

    const pair = this.pickPair(now);
    const state = pair ? pair.state : null;
    ctx.save();
    if (this.shake > 0 && !this.reduced) {
      ctx.translate((Math.random() * 2 - 1) * this.shake, (Math.random() * 2 - 1) * this.shake);
    }
    this.drawArenaFrame(state);
    if (state) {
      const showWorld = state.phase === 'round' || state.phase === 'over';
      if (showWorld) {
        this.drawVoid(state, now);
        this.drawPickups(state, now);
        this.drawSnakes(pair, now);
        this.drawParticles();
        this.drawStormWarning(state, now);
      } else {
        this.drawIdleGrid(state, now);
        this.drawParticles();
      }
    }
    ctx.restore();

    if (this.flash > 0) {
      const gradient = ctx.createRadialGradient(
        this.vw / 2,
        this.vh / 2,
        Math.min(this.vw, this.vh) * 0.2,
        this.vw / 2,
        this.vh / 2,
        Math.max(this.vw, this.vh) * 0.75
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, rgba(this.flashColor, 0.5 * this.flash));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.vw, this.vh);
    }
  }

  drawBackdrop(now) {
    const ctx = this.ctx;
    const w = this.vw;
    const h = this.vh;
    const gradient = ctx.createRadialGradient(w * 0.36, h * 0.32, 0, w * 0.5, h * 0.55, Math.max(w, h) * 0.85);
    gradient.addColorStop(0, '#0b1226');
    gradient.addColorStop(0.55, '#060a18');
    gradient.addColorStop(1, '#02030a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glowA = ctx.createRadialGradient(w * 0.18, h * 0.1, 0, w * 0.18, h * 0.1, w * 0.55);
    glowA.addColorStop(0, 'rgba(93,242,255,0.055)');
    glowA.addColorStop(1, 'rgba(93,242,255,0)');
    ctx.fillStyle = glowA;
    ctx.fillRect(0, 0, w, h);
    const glowB = ctx.createRadialGradient(w * 0.9, h * 0.9, 0, w * 0.9, h * 0.9, w * 0.5);
    glowB.addColorStop(0, 'rgba(255,93,143,0.045)');
    glowB.addColorStop(1, 'rgba(255,93,143,0)');
    ctx.fillStyle = glowB;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    for (const star of this.stars) {
      const twinkle = 0.55 + Math.sin(now / 1000 * star.speed + star.phase) * 0.35;
      ctx.globalAlpha = this.reduced ? 0.5 : twinkle;
      ctx.fillStyle = star.tint;
      ctx.beginPath();
      ctx.arc(star.x * w, star.y * h, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawArenaFrame(state) {
    const ctx = this.ctx;
    const x = this.ox;
    const y = this.oy;
    const w = this.bw;
    const h = this.bh;
    ctx.save();
    roundRect(ctx, x - 10, y - 10, w + 20, h + 20, 16);
    ctx.fillStyle = 'rgba(3,6,16,0.5)';
    ctx.fill();
    roundRect(ctx, x - 10, y - 10, w + 20, h + 20, 16);
    ctx.strokeStyle = 'rgba(93,242,255,0.09)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, x, y, w, h, 8);
    ctx.clip();
    const floor = ctx.createLinearGradient(x, y, x, y + h);
    floor.addColorStop(0, 'rgba(8,15,33,0.9)');
    floor.addColorStop(1, 'rgba(4,8,20,0.92)');
    ctx.fillStyle = floor;
    ctx.fillRect(x, y, w, h);

    const cell = this.cell;
    ctx.strokeStyle = 'rgba(120,190,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 1; gx < W; gx++) {
      ctx.moveTo(x + gx * cell + 0.5, y);
      ctx.lineTo(x + gx * cell + 0.5, y + h);
    }
    for (let gy = 1; gy < H; gy++) {
      ctx.moveTo(x, y + gy * cell + 0.5);
      ctx.lineTo(x + w, y + gy * cell + 0.5);
    }
    ctx.stroke();

    ctx.fillStyle = 'rgba(120,200,255,0.08)';
    for (let gx = 2; gx < W; gx += 2) {
      for (let gy = 2; gy < H; gy += 2) {
        ctx.fillRect(x + gx * cell - 0.5, y + gy * cell - 0.5, 1, 1);
      }
    }

    const centerGlow = ctx.createRadialGradient(
      x + w / 2,
      y + h / 2,
      0,
      x + w / 2,
      y + h / 2,
      Math.max(w, h) * 0.55
    );
    centerGlow.addColorStop(0, 'rgba(93,242,255,0.038)');
    centerGlow.addColorStop(1, 'rgba(93,242,255,0)');
    ctx.fillStyle = centerGlow;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    roundRect(ctx, x, y, w, h, 8);
    ctx.strokeStyle = 'rgba(93,242,255,0.24)';
    ctx.lineWidth = 1.4;
    ctx.shadowColor = 'rgba(93,242,255,0.35)';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const arm = Math.min(26, this.cell * 1.4);
    ctx.strokeStyle = 'rgba(93,242,255,0.55)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x - 4, y + arm);
    ctx.lineTo(x - 4, y - 4);
    ctx.lineTo(x + arm, y - 4);
    ctx.moveTo(x + w - arm, y - 4);
    ctx.lineTo(x + w + 4, y - 4);
    ctx.lineTo(x + w + 4, y + arm);
    ctx.moveTo(x - 4, y + h - arm);
    ctx.lineTo(x - 4, y + h + 4);
    ctx.lineTo(x + arm, y + h + 4);
    ctx.moveTo(x + w - arm, y + h + 4);
    ctx.lineTo(x + w + 4, y + h + 4);
    ctx.lineTo(x + w + 4, y + h - arm);
    ctx.stroke();
    if (state) void state;
    ctx.restore();
  }

  boundsRect(bounds) {
    const cell = this.cell;
    return {
      x: this.ox + bounds.x0 * cell,
      y: this.oy + bounds.y0 * cell,
      w: (bounds.x1 - bounds.x0 + 1) * cell,
      h: (bounds.y1 - bounds.y0 + 1) * cell
    };
  }

  drawIdleGrid(state, now) {
    const ctx = this.ctx;
    const pulse = 0.35 + Math.sin(now / 900) * 0.08;
    const rect = this.boundsRect(state.bounds);
    ctx.save();
    ctx.strokeStyle = `rgba(93,242,255,${pulse * 0.35})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 10]);
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.restore();
  }

  drawVoid(state, now) {
    const ctx = this.ctx;
    const board = { x: this.ox, y: this.oy, w: this.bw, h: this.bh };
    const bright = state.phase === 'round';
    const rect = this.boundsRect(state.bounds);
    const full =
      state.bounds.x0 === 0 &&
      state.bounds.y0 === 0 &&
      state.bounds.x1 === W - 1 &&
      state.bounds.y1 === H - 1;
    if (full) return;

    ctx.save();
    roundRect(ctx, board.x, board.y, board.w, board.h, 8);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(board.x, board.y, board.w, board.h);
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip('evenodd');
    ctx.fillStyle = 'rgba(2,3,9,0.84)';
    ctx.fillRect(board.x, board.y, board.w, board.h);
    ctx.strokeStyle = 'rgba(255,77,109,0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = Math.max(14, this.cell);
    for (let d = -board.h; d < board.w; d += step) {
      ctx.moveTo(board.x + d, board.y);
      ctx.lineTo(board.x + d + board.h, board.y + board.h);
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    roundRect(ctx, board.x, board.y, board.w, board.h, 8);
    ctx.clip();
    ctx.strokeStyle = bright ? 'rgba(255,93,143,0.5)' : 'rgba(93,242,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = bright ? 'rgba(255,93,143,0.65)' : 'rgba(93,242,255,0.4)';
    ctx.shadowBlur = 12 + Math.sin(now / 380) * 3;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
  }

  drawStormWarning(state, now) {
    if (state.phase !== 'round' || !state.shrink || state.shrink.ms > 3800) return;
    const ctx = this.ctx;
    const rect = this.boundsRect(state.bounds);
    const urgency = clamp(1 - state.shrink.ms / 3800, 0, 1);
    const pulse = 0.55 + 0.45 * Math.sin(now / 100);
    const depth = Math.min(rect.w, rect.h, this.cell * 2.2);
    const side = state.shrink.side;
    let gradient;
    let strip;
    if (side === 0) {
      gradient = ctx.createLinearGradient(rect.x + rect.w, 0, rect.x + rect.w - depth, 0);
      strip = [rect.x + rect.w - depth, rect.y, depth, rect.h];
    } else if (side === 2) {
      gradient = ctx.createLinearGradient(rect.x, 0, rect.x + depth, 0);
      strip = [rect.x, rect.y, depth, rect.h];
    } else if (side === 1) {
      gradient = ctx.createLinearGradient(0, rect.y + rect.h, 0, rect.y + rect.h - depth);
      strip = [rect.x, rect.y + rect.h - depth, rect.w, depth];
    } else {
      gradient = ctx.createLinearGradient(0, rect.y, 0, rect.y + depth);
      strip = [rect.x, rect.y, rect.w, depth];
    }
    gradient.addColorStop(0, `rgba(255,77,109,${0.36 * urgency * pulse})`);
    gradient.addColorStop(1, 'rgba(255,77,109,0)');
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(strip[0], strip[1], strip[2], strip[3]);
    ctx.strokeStyle = `rgba(255,120,145,${0.45 * urgency * pulse})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    const lineX = side === 0 ? rect.x + rect.w - 1 : side === 2 ? rect.x + 1 : 0;
    const lineY = side === 1 ? rect.y + rect.h - 1 : side === 3 ? rect.y + 1 : 0;
    ctx.beginPath();
    if (side === 0 || side === 2) {
      ctx.moveTo(lineX, rect.y);
      ctx.lineTo(lineX, rect.y + rect.h);
    } else {
      ctx.moveTo(rect.x, lineY);
      ctx.lineTo(rect.x + rect.w, lineY);
    }
    ctx.stroke();
    ctx.restore();
  }

  drawPickups(state, now) {
    const ctx = this.ctx;
    const cell = this.cell;
    for (const pickup of state.pickups) {
      const x = this.ox + (cellX(pickup.cell) + 0.5) * cell;
      const y = this.oy + (cellY(pickup.cell) + 0.5) * cell;
      const pulse = 0.82 + Math.sin(now / 280 + pickup.cell) * 0.18;
      ctx.save();
      ctx.translate(x, y);
      ctx.globalCompositeOperation = 'lighter';
      if (pickup.type === 'f') {
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.55);
        halo.addColorStop(0, 'rgba(141,255,210,0.35)');
        halo.addColorStop(1, 'rgba(141,255,210,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8dffd2';
        ctx.shadowColor = '#8dffd2';
        ctx.shadowBlur = cell * 0.5;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.14 * pulse, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.055, 0, Math.PI * 2);
        ctx.fill();
      } else if (pickup.type === 'g') {
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.8);
        halo.addColorStop(0, 'rgba(255,210,93,0.42)');
        halo.addColorStop(1, 'rgba(255,210,93,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(now / 900);
        ctx.fillStyle = '#ffe29a';
        ctx.shadowColor = '#ffd25d';
        ctx.shadowBlur = cell * 0.7;
        const r = cell * 0.3 * pulse;
        ctx.beginPath();
        ctx.moveTo(0, -r * 1.4);
        ctx.lineTo(r * 0.42, 0);
        ctx.lineTo(0, r * 1.4);
        ctx.lineTo(-r * 0.42, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.055, 0, Math.PI * 2);
        ctx.fill();
      } else if (pickup.type === 'p') {
        const color = '#5df2ff';
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.75);
        halo.addColorStop(0, 'rgba(93,242,255,0.4)');
        halo.addColorStop(1, 'rgba(93,242,255,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(now / 700);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.2, cell * 0.07);
        ctx.shadowColor = color;
        ctx.shadowBlur = cell * 0.65;
        const r = cell * 0.3 * pulse;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(220,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.06, 0, Math.PI * 2);
        ctx.fill();
      } else if (pickup.type === 'q') {
        const color = '#ff8a3d';
        const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.75);
        halo.addColorStop(0, 'rgba(255,138,61,0.4)');
        halo.addColorStop(1, 'rgba(255,138,61,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.75, 0, Math.PI * 2);
        ctx.fill();
        ctx.rotate(Math.sin(now / 600) * 0.25);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1.2, cell * 0.07);
        ctx.shadowColor = color;
        ctx.shadowBlur = cell * 0.65;
        const r = cell * 0.32 * pulse;
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.9, r);
        ctx.lineTo(-r * 0.9, r);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,220,180,0.9)';
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  leaderId(state) {
    let best = null;
    for (const actor of state.actors) {
      if (!actor.alive || actor.score <= 0) continue;
      if (!best || actor.score > best.score || (actor.score === best.score && actor.id < best.id)) best = actor;
    }
    return best ? best.id : null;
  }

  drawSnakes(pair, now) {
    if (!pair) return;
    const { prev, next, progress, state } = pair;
    const prevState = prev.s;
    const canLerp =
      progress < 1 && prevState.phase === next.s.phase && (next.s.phase === 'round' || next.s.phase === 'over');
    const prevActors = new Map((prevState.actors || []).map((a) => [a.id, a]));
    const labels = [];
    const leader = this.leaderId(state);
    const cell = this.cell;

    for (const actor of state.actors) {
      if (!actor.alive || !actor.body.length) continue;
      const prevActor = canLerp ? prevActors.get(actor.id) : null;
      const usePrev = prevActor && prevActor.alive && prevActor.body.length > 0;
      const points = actor.body.map((cellIndex, i) => {
        const cx = cellX(cellIndex);
        const cy = cellY(cellIndex);
        if (!usePrev) {
          return { x: this.ox + (cx + 0.5) * cell, y: this.oy + (cy + 0.5) * cell };
        }
        const from = prevActor.body[Math.min(i, prevActor.body.length - 1)];
        return {
          x: this.ox + (lerp(cellX(from), cx, progress) + 0.5) * cell,
          y: this.oy + (lerp(cellY(from), cy, progress) + 0.5) * cell
        };
      });

      const color = PLAYER_COLORS[actor.color % PLAYER_COLORS.length];
      const isMe = actor.id === this.myId;
      const ghost = actor.ghost;
      const frenzy = actor.frenzy;
      const width = cell * (ghost ? 0.52 : 0.68);
      const ctx = this.ctx;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = ghost ? 0.48 : 1;

      tracePath(ctx, points);
      ctx.strokeStyle = rgba(color, ghost ? 0.22 : 0.3);
      ctx.lineWidth = width * 1.9;
      ctx.shadowColor = color;
      ctx.shadowBlur = cell * (frenzy ? 1.7 : 1.1);
      ctx.stroke();
      ctx.shadowBlur = 0;

      tracePath(ctx, points);
      ctx.strokeStyle = frenzy ? '#ffb066' : color;
      ctx.lineWidth = width;
      ctx.globalAlpha = ghost ? 0.4 : 0.9;
      ctx.stroke();

      tracePath(ctx, points);
      ctx.strokeStyle = rgba('#ffffff', ghost ? 0.35 : 0.5);
      ctx.lineWidth = Math.max(1, width * 0.24);
      ctx.globalAlpha = ghost ? 0.3 : 0.7;
      ctx.stroke();

      if (ghost) {
        tracePath(ctx, points);
        ctx.setLineDash([cell * 0.34, cell * 0.28]);
        ctx.lineDashOffset = -now / 45;
        ctx.strokeStyle = 'rgba(180,255,255,0.65)';
        ctx.lineWidth = Math.max(1, width * 0.12);
        ctx.globalAlpha = 0.7;
        ctx.stroke();
      }
      ctx.restore();

      const headPoint = points[0];
      const neckPoint = points[1] || points[0];
      let dirX = headPoint.x - neckPoint.x;
      let dirY = headPoint.y - neckPoint.y;
      const len = Math.hypot(dirX, dirY) || 1;
      dirX /= len;
      dirY /= len;

      ctx.save();
      const headR = cell * (ghost ? 0.33 : 0.38);
      ctx.shadowColor = color;
      ctx.shadowBlur = cell * 0.7;
      ctx.fillStyle = color;
      ctx.globalAlpha = ghost ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(headPoint.x, headPoint.y, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      const eyeForward = headR * 0.34;
      const eyeSide = headR * 0.42;
      const px = -dirY;
      const py = dirX;
      const eyeR = Math.max(1.1, cell * 0.085);
      for (const sign of [-1, 1]) {
        const ex = headPoint.x + dirX * eyeForward + px * eyeSide * sign;
        const ey = headPoint.y + dirY * eyeForward + py * eyeSide * sign;
        ctx.fillStyle = 'rgba(255,255,255,0.94)';
        ctx.beginPath();
        ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#07101d';
        ctx.beginPath();
        ctx.arc(ex + dirX * eyeR * 0.45, ey + dirY * eyeR * 0.45, eyeR * 0.52, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isMe) {
        ctx.strokeStyle = rgba('#ffffff', 0.55 + 0.2 * Math.sin(now / 220));
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(headPoint.x, headPoint.y, headR + cell * 0.36, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (frenzy) {
        ctx.strokeStyle = `rgba(255,170,80,${0.4 + 0.25 * Math.sin(now / 110)})`;
        ctx.lineWidth = Math.max(1, cell * 0.09);
        ctx.beginPath();
        ctx.arc(headPoint.x, headPoint.y, headR + cell * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      labels.push({ actor, point: headPoint, color, isMe, leader: leader === actor.id });
    }

    for (const label of labels) this.drawLabel(label, now);
  }

  drawLabel({ actor, point, color, isMe, leader }, now) {
    const ctx = this.ctx;
    const cell = this.cell;
    const base = this.nameOf(actor.id);
    const name = base.length > 13 ? `${base.slice(0, 13)}…` : base;
    const text = isMe ? `${name} · YOU` : name;
    const font = Math.max(9, Math.min(13, cell * 0.4));
    ctx.save();
    ctx.font = `600 ${font}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width;
    const pillW = width + font * 1.1;
    const pillH = font * 1.55;
    let x = point.x;
    let y = point.y - cell * 0.9 - pillH;
    x = clamp(x, this.ox + pillW / 2 + 2, this.ox + this.bw - pillW / 2 - 2);
    y = Math.max(this.oy + pillH / 2 + 4, y);
    ctx.globalAlpha = actor.ghost ? 0.65 : 1;
    roundRect(ctx, x - pillW / 2, y - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(2,6,16,0.62)';
    ctx.fill();
    ctx.strokeStyle = rgba(color, isMe ? 0.7 : 0.3);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = isMe ? 8 : 3;
    ctx.fillText(text, x, y + 0.5);
    ctx.shadowBlur = 0;
    if (leader) {
      const crownY = y - pillH / 2 - font * 0.8;
      const cw = font * 0.9;
      ctx.fillStyle = '#ffd25d';
      ctx.shadowColor = '#ffd25d';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(x - cw / 2, crownY + font * 0.45);
      ctx.lineTo(x - cw / 2, crownY);
      ctx.lineTo(x - cw / 6, crownY + font * 0.22);
      ctx.lineTo(x, crownY - font * 0.18);
      ctx.lineTo(x + cw / 6, crownY + font * 0.22);
      ctx.lineTo(x + cw / 2, crownY);
      ctx.lineTo(x + cw / 2, crownY + font * 0.45);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
    void now;
  }

  drawParticles() {
    if (!this.particles.length) return;
    const ctx = this.ctx;
    const cell = this.cell;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const particle of this.particles) {
      const life = clamp(particle.life / particle.maxLife, 0, 1);
      const x = this.ox + particle.x * cell;
      const y = this.oy + particle.y * cell;
      ctx.globalAlpha = Math.min(1, life * 1.2);
      ctx.fillStyle = particle.color;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = cell * 0.3;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.7, particle.size * cell * life + 0.5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
