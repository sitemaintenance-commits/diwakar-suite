// The people who built the suite. Deliberately outside the module and
// permission system: it is not in the menu, not in Admin -> Modules or
// Roles, and is reached by clicking the copyright line at the foot of the
// menu five times.
//
// It is meant to be fun: click the photo for confetti, drag the stickers
// around, flip the cards for a secret, and buy the team a chai.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Code2, Compass, Heart, RotateCcw, ShieldCheck } from 'lucide-react';

const TEAM = [
  {
    name: 'Keshav',
    role: 'Lead Developer & Architect',
    note: 'Database, security and the engine under every section',
    icon: Code2,
    emoji: '🧑‍💻',
    superpower: 'Turns bugs into features before anyone notices',
    fuel: 'Chai at 2 am',
    quote: '“It works on my machine.”',
  },
  {
    name: 'Aditya',
    role: 'Product & Design Lead',
    note: 'How every screen looks, feels and flows — and the story around it',
    icon: Compass,
    emoji: '🎨',
    superpower: 'Spots a 1-pixel misalignment from across the room',
    fuel: '“Just one more tweak”',
    quote: '“Can we make it pop a bit more?”',
  },
  {
    name: 'Diksha',
    role: 'Quality & Data Lead',
    note: 'Testing, data accuracy and the details nobody else catches',
    icon: ShieldCheck,
    emoji: '🔍',
    superpower: 'Finds the bug in five seconds flat',
    fuel: 'Snacks and suspicion',
    quote: '“Did you test it on a phone?”',
  },
];

const BURST = ['☀️', '⚡', '🔆', '🎉', '✨', '🌞', '🔋', '💡'];
const CHAI_LINES = [
  'The team thanks you ☕',
  'Productivity +10%',
  'Another bug fixed somewhere',
  'Keshav is typing faster now',
  'Aditya approved the colour of this chai',
  'Diksha tested the chai. It passed.',
  'Ok, that is a lot of chai',
  'Someone call the canteen',
];

const STICKERS = [
  { id: 'sun', text: '☀️ Powered by sunshine', x: 6, y: 8, rot: -8, bg: 'bg-amber-300 text-amber-950' },
  { id: 'bugs', text: '🐛 0 bugs*', x: 72, y: 12, rot: 7, bg: 'bg-rose-300 text-rose-950' },
  { id: 'ship', text: '🚀 Shipped!', x: 78, y: 70, rot: -5, bg: 'bg-sky-300 text-sky-950' },
  { id: 'apps', text: '4 apps → 1', x: 4, y: 72, rot: 6, bg: 'bg-lime-300 text-lime-950' },
];

interface Bit { id: number; x: number; y: number; e: string; dx: number; dy: number; r: number }

function readChai() {
  try { return Number(localStorage.getItem('credits-chai') ?? 0) || 0; } catch { return 0; }
}

export function CreditsPage() {
  const [photo, setPhoto] = useState(true);
  const [bits, setBits] = useState<Bit[]>([]);
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const [chai, setChai] = useState(readChai);
  const [chaiLine, setChaiLine] = useState('');
  const [pos, setPos] = useState(() => Object.fromEntries(STICKERS.map((s) => [s.id, { x: s.x, y: s.y }])));
  const [wiggle, setWiggle] = useState<string | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    try { localStorage.setItem('credits-chai', String(chai)); } catch { /* not kept */ }
  }, [chai]);

  /** A burst of sunny emoji from where the click landed. */
  function burst(clientX: number, clientY: number, count = 18) {
    const box = stage.current?.getBoundingClientRect();
    if (!box) return;
    const x = clientX - box.left;
    const y = clientY - box.top;
    const fresh: Bit[] = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 120;
      return { id: nextId.current++, x, y, e: BURST[Math.floor(Math.random() * BURST.length)],
        dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist - 40, r: (Math.random() - 0.5) * 540 };
    });
    setBits((b) => [...b, ...fresh]);
    window.setTimeout(() => setBits((b) => b.filter((x0) => !fresh.includes(x0))), 1100);
  }

  function onStickerDown(e: RPointerEvent, id: string) {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, moved: false };
  }
  function onStickerMove(e: RPointerEvent) {
    if (!drag.current || !stage.current) return;
    const box = stage.current.getBoundingClientRect();
    drag.current.moved = true;
    setPos((p) => ({ ...p, [drag.current!.id]: {
      x: Math.min(92, Math.max(0, ((e.clientX - box.left) / box.width) * 100 - 6)),
      y: Math.min(92, Math.max(0, ((e.clientY - box.top) / box.height) * 100 - 4)),
    } }));
  }
  function onStickerUp(e: RPointerEvent, id: string) {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      setWiggle(id);
      burst(e.clientX, e.clientY, 8);
      window.setTimeout(() => setWiggle(null), 600);
    }
  }

  function buyChai(e: React.MouseEvent) {
    setChai((c) => {
      const n = c + 1;
      setChaiLine(CHAI_LINES[Math.min(CHAI_LINES.length - 1, Math.floor(Math.log2(n + 1)))]);
      return n;
    });
    burst(e.clientX, e.clientY, 10);
  }

  return (
    <div className="mx-auto max-w-4xl">
      <style>{`
        @keyframes credits-pop { 0% { transform: translate(0,0) rotate(0) scale(.6); opacity: 1 }
          100% { transform: translate(var(--dx), var(--dy)) rotate(var(--r)) scale(1.2); opacity: 0 } }
        @keyframes credits-wiggle { 0%,100% { transform: rotate(var(--rot)) scale(1) } 25% { transform: rotate(calc(var(--rot) - 14deg)) scale(1.15) }
          75% { transform: rotate(calc(var(--rot) + 14deg)) scale(1.15) } }
        @keyframes credits-float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
        .credits-flip { transform-style: preserve-3d; transition: transform .6s cubic-bezier(.22,1,.36,1) }
        .credits-flip.is-flipped { transform: rotateY(180deg) }
        .credits-face { backface-visibility: hidden }
        .credits-back { transform: rotateY(180deg) }
        @media (prefers-reduced-motion: reduce) { .credits-flip { transition: none } }
      `}</style>

      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="card-rise overflow-hidden rounded-3xl border bg-card shadow-card">
        {/* --------------------------------------------- photo + stickers */}
        <div ref={stage} className="relative cursor-pointer select-none overflow-hidden" onClick={(e) => burst(e.clientX, e.clientY)}
          title="Click me" role="presentation">
          {photo ? (
            <img src="/crew/team.jpg" alt="The team behind the Management Suite" draggable={false}
              className="aspect-[2.25/1] w-full object-cover" onError={() => setPhoto(false)} />
          ) : (
            <div className="flex aspect-[2.25/1] items-center justify-center bg-primary-soft text-6xl">☀️</div>
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
          <p className="pointer-events-none absolute bottom-4 left-6 text-xs font-medium uppercase tracking-[0.2em] text-white/85">
            The team behind it · click anywhere ✨
          </p>

          {STICKERS.map((s) => (
            <button key={s.id} type="button"
              onPointerDown={(e) => onStickerDown(e, s.id)} onPointerMove={onStickerMove} onPointerUp={(e) => onStickerUp(e, s.id)}
              onClick={(e) => e.stopPropagation()}
              style={{ left: `${pos[s.id].x}%`, top: `${pos[s.id].y}%`, ['--rot' as string]: `${s.rot}deg`, transform: `rotate(${s.rot}deg)`,
                animation: wiggle === s.id ? 'credits-wiggle .6s ease-in-out' : undefined, touchAction: 'none' }}
              className={`absolute cursor-grab rounded-xl border-2 border-white px-2.5 py-1 text-xs font-bold shadow-lg active:cursor-grabbing sm:text-sm ${s.bg}`}
              title="Drag me around">
              {s.text}
            </button>
          ))}

          {bits.map((b) => (
            <span key={b.id} className="pointer-events-none absolute text-2xl"
              style={{ left: b.x, top: b.y, ['--dx' as string]: `${b.dx}px`, ['--dy' as string]: `${b.dy}px`, ['--r' as string]: `${b.r}deg`,
                animation: 'credits-pop 1.05s cubic-bezier(.22,1,.36,1) forwards' }}>
              {b.e}
            </span>
          ))}
        </div>

        <div className="px-6 py-8 sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Diwakar Solar Management Suite</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Built with care, from scratch</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Four separate apps became one platform — dashboards, projects, plants, people, approvals and procurement —
            designed, built and tested by three people. <span className="whitespace-nowrap">(Tap a card. You know you want to.)</span>
          </p>

          {/* ----------------------------------------------- flip cards */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {TEAM.map((m, i) => (
              <button key={m.name} type="button" onClick={() => setFlipped((f) => ({ ...f, [m.name]: !f[m.name] }))}
                style={{ animationDelay: `${(i + 1) * 90}ms`, perspective: '1000px' }}
                className="card-rise group h-56 text-left" aria-label={`${m.name}: flip the card`}>
                <div className={`credits-flip relative h-full w-full ${flipped[m.name] ? 'is-flipped' : ''}`}>
                  <div className="credits-face absolute inset-0 rounded-2xl border bg-background p-5 transition-shadow group-hover:shadow-[0_14px_32px_-14px_rgb(232_116_12/0.35)]">
                    <div className="flex items-start justify-between">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <m.icon className="h-5 w-5" />
                      </span>
                      <span className="text-3xl transition-transform duration-300 group-hover:-rotate-12 group-hover:scale-125"
                        style={{ animation: `credits-float 3s ease-in-out ${i * 0.4}s infinite` }}>{m.emoji}</span>
                    </div>
                    <p className="mt-4 text-lg font-semibold tracking-tight">{m.name}</p>
                    <p className="text-sm font-medium text-primary">{m.role}</p>
                    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{m.note}</p>
                    <p className="absolute bottom-3 right-4 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">tap to flip ↻</p>
                  </div>
                  <div className="credits-face credits-back absolute inset-0 rounded-2xl bg-gradient-to-br from-primary to-orange-400 p-5 text-primary-foreground">
                    <p className="text-xs font-semibold uppercase tracking-wider text-white/80">Classified file · {m.name}</p>
                    <p className="mt-3 text-[11px] uppercase tracking-wider text-white/70">Superpower</p>
                    <p className="text-sm font-semibold leading-snug">{m.superpower}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-wider text-white/70">Runs on</p>
                    <p className="text-sm font-semibold">{m.fuel}</p>
                    <p className="mt-2 text-sm italic text-white/90">{m.quote}</p>
                    <RotateCcw className="absolute bottom-3 right-4 h-3.5 w-3.5 text-white/70" />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* ---------------------------------------------- chai counter */}
          <div className="mt-8 flex flex-col items-start gap-3 rounded-2xl border border-dashed border-primary/40 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold">Liked the suite?</p>
              <p className="text-xs text-muted-foreground">
                {chai ? <>You have bought the team <span className="tabular font-bold text-primary">{chai}</span> virtual chai{chai === 1 ? '' : 's'}. {chaiLine}</> : 'Fuel the next feature.'}
              </p>
            </div>
            <button type="button" onClick={buyChai}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition active:scale-95 hover:-translate-y-0.5 hover:shadow-lg">
              Buy the team a chai ☕
            </button>
          </div>

          <figure className="mt-8 rounded-2xl bg-gradient-to-br from-primary-soft to-transparent px-6 py-6">
            <blockquote className="text-lg font-medium leading-snug tracking-tight">
              “Great things are not done by impulse, but by a series of small things brought together.”
            </blockquote>
            <figcaption className="mt-2 text-xs text-muted-foreground">— Vincent van Gogh (and every late-night deploy)</figcaption>
          </figure>

          <p className="mt-8 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            Made with <Heart className="h-3.5 w-3.5 fill-primary text-primary" /> and a lot of chai in Jaipur · {new Date().getFullYear()}
            <span className="ml-auto text-[10px] text-muted-foreground/60">*mostly</span>
          </p>
        </div>
      </div>
    </div>
  );
}
