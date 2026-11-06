// Diwali fireworks, 6 to 8 November 2026: a show when the site is first
// opened in a session, and a rocket that rises from the button clicked and
// bursts out on the screen -- every sidebar section and link, and the main
// (orange) buttons: Save, Submit, Approve, Sign in and the like, never
// Delete, Reject or Cancel. One canvas over the page that ignores the
// mouse; it draws only while something is in the air. Off for anyone who
// has asked their device for reduced motion.
import { todayIST } from '@/lib/format';

const FROM = '2026-11-06';
const UNTIL = '2026-11-08';
const COLORS = ['#ff3b6b', '#ff8a00', '#ffd23f', '#3ddc84', '#4fc3f7', '#c77dff', '#fff3b0', '#ff5edb'];
const SKIP = /\b(delete|reject|remove|cancel|discard|sign out|log out|deactivate)\b/i;

interface Spark { x: number; y: number; px: number; py: number; vx: number; vy: number; life: number; max: number; color: string; size: number }
interface Flash { x: number; y: number; r: number; life: number; max: number }
interface Rocket { x0: number; y0: number; tx: number; ty: number; bend: number; t: number; steps: number; x: number; y: number }

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
const sparks: Spark[] = [];
const flashes: Flash[] = [];
const rockets: Rocket[] = [];
let running = false;

function setup() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  const size = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas!.width = window.innerWidth * dpr;
    canvas!.height = window.innerHeight * dpr;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  window.addEventListener('resize', size);
}

function frame() {
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (let i = flashes.length - 1; i >= 0; i -= 1) {
    const f = flashes[i];
    const t = f.life / f.max;
    const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
    g.addColorStop(0, `rgba(255,236,150,${0.95 * (1 - t)})`);
    g.addColorStop(0.4, `rgba(255,140,30,${0.55 * (1 - t)})`);
    g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    ctx.fill();
    f.life += 1;
    if (f.life >= f.max) flashes.splice(i, 1);
  }

  for (let i = rockets.length - 1; i >= 0; i -= 1) {
    const r = rockets[i];
    r.t += 1 / r.steps;
    // Fast off the button, slowing as it climbs, on a slight curve.
    const e = 1 - (1 - Math.min(r.t, 1)) ** 2;
    const nx = r.x0 + (r.tx - r.x0) * e + Math.sin(Math.PI * e) * r.bend;
    const ny = r.y0 + (r.ty - r.y0) * e;
    for (let k = 0; k < 3; k += 1) {
      sparks.push({ x: nx, y: ny, px: nx, py: ny, vx: (Math.random() - 0.5) * 0.8, vy: Math.random() * 0.8,
        life: 0, max: 14 + Math.random() * 12, color: Math.random() < 0.7 ? '#ffb347' : '#fff3b0', size: 0.9 + Math.random() * 0.9 });
    }
    r.x = nx;
    r.y = ny;
    const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, 9);
    g.addColorStop(0, 'rgba(255,250,210,1)');
    g.addColorStop(0.5, 'rgba(255,160,40,0.7)');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(nx, ny, 9, 0, Math.PI * 2);
    ctx.fill();
    if (r.t >= 1) {
      rockets.splice(i, 1);
      burst(r.tx, r.ty, 85, 1.35);
    }
  }

  for (let i = sparks.length - 1; i >= 0; i -= 1) {
    const s = sparks[i];
    s.px = s.x;
    s.py = s.y;
    s.vx *= 0.975;
    s.vy = s.vy * 0.975 + 0.055;
    s.x += s.vx;
    s.y += s.vy;
    s.life += 1;
    const alpha = Math.max(0, 1 - s.life / s.max);
    // A short trail, then a bright head that twinkles as it fades.
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = alpha * 0.6;
    ctx.lineWidth = s.size * 0.7;
    ctx.beginPath();
    ctx.moveTo(s.px - s.vx * 2, s.py - s.vy * 2);
    ctx.lineTo(s.x, s.y);
    ctx.stroke();
    ctx.globalAlpha = alpha * (s.life > s.max * 0.6 ? 0.5 + Math.random() * 0.5 : 1);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
    ctx.fill();
    if (s.life >= s.max) sparks.splice(i, 1);
  }
  ctx.globalAlpha = 1;

  if (sparks.length || flashes.length || rockets.length) requestAnimationFrame(frame);
  else {
    running = false;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

/** One firework at a point on the screen. */
export function burst(x: number, y: number, count = 70, power = 1) {
  setup();
  flashes.push({ x, y, r: 26 * power + 10, life: 0, max: 18 });
  const tint = COLORS[Math.floor(Math.random() * COLORS.length)];
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const speed = (1.2 + Math.random() * 3.6) * power;
    sparks.push({
      x, y, px: x, py: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.6 * power,
      life: 0,
      max: 45 + Math.random() * 35,
      // Mostly mixed colours, with some of one colour so each burst has a character.
      color: Math.random() < 0.35 ? tint : COLORS[Math.floor(Math.random() * COLORS.length)],
      size: 1.2 + Math.random() * 1.6,
    });
  }
  run();
}

function run() {
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
}

/** A rocket from a point (a button) up to somewhere on the screen, where it bursts. */
export function launch(x: number, y: number) {
  setup();
  const w = window.innerWidth;
  const h = window.innerHeight;
  // Somewhere around the middle of the screen, a little different each time.
  const tx = w * (0.22 + Math.random() * 0.56);
  const ty = h * (0.16 + Math.random() * 0.38);
  const dist = Math.hypot(tx - x, ty - y);
  rockets.push({ x0: x, y0: y, tx, ty, bend: (Math.random() - 0.5) * 80, t: 0, steps: Math.round(30 + Math.min(dist, 900) / 30), x, y });
  // A puff where it leaves the button.
  flashes.push({ x, y, r: 16, life: 0, max: 10 });
  for (let i = 0; i < 12; i += 1) {
    const a = Math.random() * Math.PI * 2;
    sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * 1.6, vy: Math.sin(a) * 1.6, life: 0, max: 16 + Math.random() * 10,
      color: COLORS[Math.floor(Math.random() * COLORS.length)], size: 1 + Math.random() });
  }
  run();
}

/** A short show across the screen. */
function show() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < 8; i += 1) {
    setTimeout(() => burst(w * (0.12 + Math.random() * 0.76), h * (0.15 + Math.random() * 0.45), 90, 1.4), 150 + i * 330);
  }
}

export function festiveOn() {
  const day = todayIST();
  return day >= FROM && day <= UNTIL && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Starts the festival effects for this page, when it is the season. */
export function startFestive() {
  if (typeof window === 'undefined' || !festiveOn()) return;

  let first = true;
  try {
    first = sessionStorage.getItem('festive-show') !== UNTIL;
    sessionStorage.setItem('festive-show', UNTIL);
  } catch { /* private window: show it anyway */ }
  if (first) {
    if (document.readyState === 'complete') setTimeout(show, 400);
    else window.addEventListener('load', () => setTimeout(show, 400), { once: true });
  }

  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    // Every section and link in the sidebar; elsewhere the main (orange) buttons.
    const el = target?.closest?.('nav[aria-label="Main"] a, nav[aria-label="Main"] button')
      ?? target?.closest?.('button.bg-primary');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (SKIP.test(el.textContent ?? '') || SKIP.test(el.getAttribute('aria-label') ?? '')) return;
    const r = el.getBoundingClientRect();
    // From the pointer; from the button's middle when it was pressed with the keyboard.
    launch(e.clientX || r.left + r.width / 2, e.clientY || r.top + r.height / 2);
  }, true);
}
