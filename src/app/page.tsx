"use client";

import { useState } from "react";

const escalationPanels = {
  nudge: {
    title: "nudge",
    description:
      "The human probably needs a three-second glance, not a brand new meeting. Surface the thing, get the steer, keep the run alive.",
    bullets: [
      "Opens the exact preview, diff, note, or comparison that matters",
      "Interrupts lightly instead of forcing another context reload",
      "Still writes to durable state if the live steer gets missed"
    ]
  },
  ask: {
    title: "ask",
    description:
      "Need one decision. Package the options, attach the context, and make the human answer the smallest useful question.",
    bullets: [
      "Puts 2-3 viable options side by side",
      "Collects buttons, text, rankings, uploads, and approvals",
      "Lets any later session resume from the stored answer"
    ]
  },
  block: {
    title: "block",
    description:
      "The run is dead until the human answers. Say it plainly, keep the blocker visible, and stop pretending chat scrollback is a state machine.",
    bullets: [
      "Shows the exact missing approval, taste call, or fact",
      "Stays live until answered, dismissed, or materially changed",
      "Optimized for response speed, not passive browsing"
    ]
  }
} as const;

type PanelName = keyof typeof escalationPanels;

const THEME_STORAGE_KEY = "humanctl-theme";

const proofPoints = [
  ["What breaks runs", "missing approvals, taste calls, and forgotten context"],
  ["What agents need", "a place to show the work and ask one crisp question"],
  ["What humanctl does", "nudge, ask, block, resume"]
];

const capabilities = [
  {
    label: "Show",
    title: "Show the exact thing they need to react to",
    body:
      "HTML previews, markdown docs, screenshots, diffs, forms, file views, charts, logs, and whatever else makes the decision obvious."
  },
  {
    label: "Ask",
    title: "Turn blocker soup into a crisp decision",
    body:
      "Bundle the problem, the viable options, the relevant evidence, and the response shape so the human can answer in seconds."
  },
  {
    label: "Resume",
    title: "Resume without replaying the whole movie",
    body:
      "The shared store is the truth. New sessions read durable files and events instead of replaying the last hour from chat crumbs."
  }
];

const manifesto = [
  {
    id: "01",
    title: "The model is not the bottleneck. The meat layer is.",
    body:
      "Agents can generate, diff, browse, and ship at machine speed. Then everything stalls on one distracted human with twelve tabs open."
  },
  {
    id: "02",
    title: "Stop treating every blocker like a fresh meeting.",
    body:
      "The human should see the exact artifact, the exact question, and the exact buttons needed to unblock the run. Nothing more."
  },
  {
    id: "03",
    title: "If the session dies, the state should not.",
    body:
      "Files back the workspace. Events carry the steer. Live delivery is a convenience; durable state is the actual system."
  }
];

export default function Home() {
  const [activePanel, setActivePanel] = useState<PanelName>("nudge");
  const panel = escalationPanels[activePanel];

  return (
    <main className="page-shell">
      <div className="grain" aria-hidden="true" />

      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">hctl</span>
          <span className="brand-name">humanctl</span>
        </div>
        <div className="header-controls">
          <nav className="top-nav">
            <a href="#why">Problem</a>
            <a href="#modes">Escalations</a>
            <a href="#model">Spec</a>
          </nav>
          <button
            aria-label="Toggle light and dark mode"
            className="theme-toggle"
            onClick={() => {
              const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";

              document.documentElement.dataset.theme = nextTheme;
              document.documentElement.style.colorScheme = nextTheme;

              try {
                window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
              } catch {}
            }}
            type="button"
          >
            <span className="theme-toggle-label" aria-hidden="true">
              <span className="theme-toggle-mode theme-toggle-mode-dark">dark</span>
              <span className="theme-toggle-mode theme-toggle-mode-light">light</span>
            </span>
            <span aria-hidden="true" className="theme-toggle-track">
              <span className="theme-toggle-thumb" />
            </span>
          </button>
        </div>
      </header>

      <section className="hero" id="why">
        <div className="hero-copy">
          <p className="eyebrow">Agent-first coordination for human bottlenecks</p>
          <h1>
            <span>Your human</span>
            <span>is the</span>
            <span>bottleneck.</span>
          </h1>
          <p className="lede">
            Agents can build, diff, browse, and ship. Then progress dies on a missing approval, an unanswered taste
            call, or a human who no longer remembers the thread. <strong>humanctl</strong> gives agents a persistent
            surface to nudge, ask, block, and resume.
          </p>
          <div className="hero-tags" aria-label="Product traits">
            <span>.humanctl/</span>
            <span>nudge ask block</span>
            <span>local-first</span>
            <span>open source</span>
          </div>
          <div className="hero-actions">
            <a className="button button-primary" href="#modes">
              Unblock your human
            </a>
            <a className="button button-secondary" href="#model">
              Read the spec
            </a>
          </div>
          <p className="tone-line">
            Built for agents who are tired of re-explaining themselves.
          </p>
        </div>

        <div className="hero-stage" id="modes">
          <div className="stage-window">
            <div className="window-chrome">
              <span />
              <span />
              <span />
            </div>
            <div className="window-body">
              <aside className="stage-rail">
                <div className="rail-title">Escalation</div>
                {(Object.keys(escalationPanels) as PanelName[]).map((name) => (
                  <button
                    key={name}
                    className={`rail-item${activePanel === name ? " is-active" : ""}`}
                    onClick={() => setActivePanel(name)}
                    type="button"
                  >
                    {name}
                  </button>
                ))}
              </aside>

              <section className="stage-panels">
                <article className="panel is-active">
                  <div className="panel-kicker">Human dependency state</div>
                  <h2>{panel.title}</h2>
                  <p>{panel.description}</p>
                  <ul className="signal-list">
                    {panel.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>

                  {activePanel === "ask" ? (
                    <div className="choice-grid">
                      <div className="choice-card">
                        Option A
                        <span>Sharper joke. Lower clarity. Higher meme yield.</span>
                      </div>
                      <div className="choice-card is-selected">
                        Option B
                        <span>Funny fast. Clear enough to trust. Recommended.</span>
                      </div>
                      <div className="choice-card">
                        Option C
                        <span>Most legible. Least likely to get screenshotted.</span>
                      </div>
                    </div>
                  ) : null}

                  {activePanel === "block" ? (
                    <div className="block-card">
                      <div className="block-label">Blocked on Daniel</div>
                      <p>Need a yes or no on shipping open source from day one before the repo, docs, and license path can be finalized.</p>
                      <button className="button button-danger" type="button">
                        Answer now
                      </button>
                    </div>
                  ) : null}
                </article>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-strip">
        {proofPoints.map(([label, value]) => (
          <div className="proof-item" key={label}>
            <span className="proof-label">{label}</span>
            <span className="proof-value">{value}</span>
          </div>
        ))}
      </section>

      <section className="manifesto">
        {manifesto.map((item) => (
          <article className="manifesto-card" key={item.id}>
            <div className="manifesto-index">{item.id}</div>
            <div>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="section section-two-up">
        <div>
          <p className="section-label">The job</p>
          <h2>Package blockers into one clean hit of human attention.</h2>
        </div>
        <div className="section-copy">
          <p>
            <code>humanctl</code> is not a dashboard for humans to babysit agents. It is an agent-first escalation
            layer for getting one useful response out of a busy person and getting back to work.
          </p>
          <p>
            Agents decide what to show, how hard to interrupt, and what answer shape they need. The backing files keep
            the truth on disk. The event queue makes it resumable across sessions, automations, and delays.
          </p>
        </div>
      </section>

      <section className="section capability-grid">
        {capabilities.map((item) => (
          <article key={item.title}>
            <p className="card-label">{item.label}</p>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </section>

      <section className="section architecture" id="model">
        <div className="section-heading">
          <p className="section-label">Local-first spec</p>
          <h2>One workspace. Durable files. A queue for steers.</h2>
        </div>
        <div className="architecture-shell">
          <pre>
            <code>{`.humanctl/
  manifest.json
  inbox/
    events.jsonl
  tabs/
    main/
      manifest.json
      things/
  artifacts/
  state/
    ui.json`}</code>
          </pre>
          <div className="architecture-notes">
            <p>
              <strong>Things</strong> are the atomic objects agents create or update.
            </p>
            <p>
              <strong>Events</strong> are the steer queue: <code>created</code>, <code>updated</code>, <code>answered</code>,
              <code>approved</code>, <code>closed</code>.
            </p>
            <p>
              <strong>Tabs</strong> are navigation and focus, not a hard schema for content.
            </p>
          </div>
        </div>
      </section>

      <section className="section final-cta">
        <p className="section-label">Open source infrastructure for human-bound agents</p>
        <h2>Stop losing momentum to the same human bottleneck.</h2>
        <p>Start with a local workspace, a tiny CLI, and a surface that treats human unblock loops like a real system.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#why">
            Back to top
          </a>
          <a className="button button-secondary" href="https://humanctl.vercel.app/">
            Live deploy
          </a>
        </div>
      </section>
    </main>
  );
}
