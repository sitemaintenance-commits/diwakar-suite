// The people who built the suite. Deliberately outside the module and
// permission system: it is not in the menu, not in Admin -> Modules or
// Roles, and is reached by clicking the copyright line at the foot of the
// menu five times.
import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Code2, Compass, Heart, ShieldCheck } from 'lucide-react';

const TEAM = [
  {
    name: 'Keshav',
    role: 'Lead Developer & Architect',
    note: 'Database, security and the engine under every section',
    icon: Code2,
  },
  {
    name: 'Aditya',
    role: 'Product & Design Lead',
    note: 'How every screen looks, feels and flows — and the story around it',
    icon: Compass,
  },
  {
    name: 'Diksha',
    role: 'Quality & Data Lead',
    note: 'Testing, data accuracy and the details nobody else catches',
    icon: ShieldCheck,
  },
];

export function CreditsPage() {
  const [photo, setPhoto] = useState(true);
  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="card-rise overflow-hidden rounded-3xl border bg-card shadow-card">
        {photo && (
          <div className="relative">
            <img src="/crew/team.jpg" alt="The team behind the Management Suite" className="aspect-[2.25/1] w-full object-cover"
              onError={() => setPhoto(false)} />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 to-transparent" />
            <p className="absolute bottom-4 left-6 text-xs font-medium uppercase tracking-[0.2em] text-white/85">The team behind it</p>
          </div>
        )}

        <div className="px-6 py-8 sm:px-10">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Diwakar Solar Management Suite</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Built with care, from scratch</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Four separate apps became one platform — dashboards, projects, plants, people, approvals and procurement —
            designed, built and tested by three people.
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {TEAM.map((m, i) => (
              <div key={m.name} style={{ animationDelay: `${(i + 1) * 90}ms` }}
                className="card-rise group rounded-2xl border bg-background p-5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-[0_14px_32px_-14px_rgb(232_116_12/0.35)]">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <m.icon className="h-5 w-5" />
                </span>
                <p className="mt-4 text-lg font-semibold tracking-tight">{m.name}</p>
                <p className="text-sm font-medium text-primary">{m.role}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{m.note}</p>
              </div>
            ))}
          </div>

          <figure className="mt-10 rounded-2xl bg-gradient-to-br from-primary-soft to-transparent px-6 py-6">
            <blockquote className="text-lg font-medium leading-snug tracking-tight">
              “Great things are not done by impulse, but by a series of small things brought together.”
            </blockquote>
            <figcaption className="mt-2 text-xs text-muted-foreground">— Vincent van Gogh</figcaption>
          </figure>

          <p className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground">
            Made with <Heart className="h-3.5 w-3.5 fill-primary text-primary" /> in Jaipur · {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </div>
  );
}
