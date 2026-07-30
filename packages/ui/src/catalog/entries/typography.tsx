import type { CatalogEntry } from "../registry"

export const typographyEntries: CatalogEntry[] = [
  {
    id: "typeset",
    name: "Typeset",
    kind: "component",
    category: "Typography",
    importPath: "styles/typeset.css",
    exports: ["typeset"],
    blurb:
      "The prose grammar for long-form content: heading, paragraph, list, quote, and inline-code rhythm. Opt in with the typeset class; typeset-chat is the compact transcript preset.",
    tags: ["prose", "class"],
    states: [
      {
        name: "Long-form and chat",
        description: "the same anatomy at two densities",
        render: () => (
          <div className="grid w-full max-w-2xl grid-cols-2 gap-8 max-[760px]:grid-cols-1">
            <article className="typeset">
              <h2>Resume with current context</h2>
              <p>Restore the last viewport immediately, then reconcile it with durable state.</p>
              <ul>
                <li>Keep the shell visible while resources load.</li>
                <li>
                  Use <code>app.state</code> as the durable authority.
                </li>
              </ul>
              <blockquote>Recheck the workspace before continuing after a long pause.</blockquote>
            </article>
            <article className="typeset typeset-chat border-l border-border pl-6 max-[760px]:border-l-0 max-[760px]:border-t max-[760px]:pt-6 max-[760px]:pl-0">
              <h3>Compact transcript prose</h3>
              <p>The same semantic anatomy fits a dense transcript without switching to a monospace face.</p>
              <p>
                <strong>Code and identifiers</strong> may still use <code>monospace</code> where meaning requires it.
              </p>
            </article>
          </div>
        ),
      },
    ],
    accessibility: ["Real heading, list, and quote elements carry document structure to assistive tech."],
    usage: `<article className="typeset">
  <h2>Resume with current context</h2>
  <p>Restore the last viewport immediately.</p>
</article>

{/* compact transcript preset */}
<article className="typeset typeset-chat">…</article>`,
  },
]
