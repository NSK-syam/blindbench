/**
 * Landing page — a STATIC page.
 *
 * It lives at the top level of src/pages/ (not under (app)/), so it renders
 * with no DeepSpace providers: no auth session fetch, no records WebSocket.
 * That makes it cheap to serve and safe for logged-out / crawler traffic.
 *
 * Need live data or auth here? Move this file to src/pages/(app)/index.tsx
 * and it becomes a dynamic page. Conversely, any page you want to keep static
 * (marketing, docs, legal) belongs at this top level.
 *
 * Top-level pages are also prerendered to static HTML at build
 * (prerender.ts, via vite.config.ts) so crawlers read real content.
 * Keep them renderable without a browser: no window/document during render,
 * prose in HTML text, reveal animations in CSS keyframes rather than JS-driven
 * initial states. `<Seo>` comes first and reads src/seo.ts.
 */

import { Link } from 'react-router-dom'
import { Seo } from '../components/Seo'
import { APP_DISPLAY_NAME } from '../constants'
import { seo } from '../seo'

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background px-6 text-foreground">
        <section className="mx-auto flex max-w-3xl flex-col items-center pb-16 pt-28 text-center sm:pt-36">
          <p className="mb-4 text-sm font-medium uppercase tracking-[0.2em] text-primary">{APP_DISPLAY_NAME}</p>
          <h1 className="mb-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Which model answers better? Let your team decide blind.
          </h1>
          <p className="mb-9 max-w-xl text-base leading-relaxed text-muted-foreground">
            Run a few prompts through two or three models, share one link, and vote on
            anonymous side-by-side answers. Standings update live; model names stay
            hidden until you close voting.
          </p>
          <Link
            to="/home"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open BlindBench
          </Link>
        </section>
        <ol className="mx-auto grid max-w-4xl gap-4 pb-24 sm:grid-cols-3">
          {[
            ['1', 'Set up', 'Up to 8 prompts and 3 models. Generate answers in the background, or paste ones you already have.'],
            ['2', 'Vote blind', 'Teammates see two anonymous answers per prompt, sides shuffled, and pick the better one. One vote per comparison.'],
            ['3', 'Reveal', 'Live counts of wins, losses, ties and “both bad”. Close voting to reveal which model was which.'],
          ].map(([n, title, body]) => (
            <li key={n} className="rounded-xl border border-border bg-card p-5">
              <p className="mb-2 font-mono text-xs text-primary">{n}</p>
              <p className="mb-1 font-medium">{title}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}
