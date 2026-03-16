import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { readWorkspace, type Thing, type ThingResponseOption, type WorkspaceEvent } from "@/lib/humanctl";
import { submitThingResponse } from "./actions";

export const dynamic = "force-dynamic";

function formatTimestamp(ts: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(ts));
}

function eventCopy(event: WorkspaceEvent, thingsById: Map<string, Thing>) {
  const targetThing = thingsById.get(event.target.thingId);
  const title = targetThing?.title ?? event.target.thingId;

  switch (event.kind) {
    case "answered":
      return `Human answered ${title}`;
    case "published":
      return `Published ${title}`;
    case "connected":
      return `Connected services for ${title}`;
    case "created":
      return `Created ${title}`;
    default:
      return `${event.kind} ${title}`;
  }
}

function optionById(options: ThingResponseOption[] | undefined, choiceId: string | undefined) {
  return options?.find((option) => option.id === choiceId);
}

type SearchParams = Promise<{
  thing?: string | string[];
}>;

export default async function WorkspacePage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requestedThingId = Array.isArray(params.thing) ? params.thing[0] : params.thing;
  const { workspace, tab, things, events } = await readWorkspace();
  const selectedThing =
    things.find((thing) => thing.id === requestedThingId) ??
    things.find((thing) => thing.needsResponse) ??
    things[0];
  const thingMap = new Map(things.map((thing) => [thing.id, thing]));
  const openCount = things.filter((thing) => thing.needsResponse).length;
  const blockedCount = things.filter((thing) => thing.status === "blocked").length;
  const answeredCount = things.filter((thing) => thing.status === "answered").length;
  const chosenOption = optionById(selectedThing?.response?.options, selectedThing?.response?.answer?.choiceId);

  return (
    <main className="workspace-page">
      <div className="grain" aria-hidden="true" />

      <header className="workspace-topbar">
        <div className="workspace-brand">
          <div className="brand">
            <span className="brand-mark">hctl</span>
            <div>
              <span className="brand-name">humanctl</span>
              <p className="workspace-subtitle">Local workspace · {workspace.name}</p>
            </div>
          </div>
          <div className="workspace-health">
            <span>{openCount} open asks</span>
            <span>{blockedCount} blocked</span>
            <span>{events.length} inbox events</span>
          </div>
        </div>

        <div className="workspace-actions">
          <Link className="workspace-link" href="/">
            Site
          </Link>
          <a className="workspace-link" href="https://github.com/danielgwilson/humanctl" rel="noreferrer" target="_blank">
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </header>

      <section className="workspace-frame">
        <aside className="workspace-sidebar">
          <div className="workspace-panel">
            <p className="workspace-label">Tab</p>
            <div className="workspace-tab-card is-active">
              <strong>{tab.title}</strong>
              <span>{tab.description}</span>
            </div>
          </div>

          <div className="workspace-panel">
            <div className="workspace-panel-header">
              <p className="workspace-label">Queue</p>
              <span className="workspace-pill">{things.length} Things</span>
            </div>
            <div className="thing-listing">
              {things.map((thing) => (
                <Link
                  className={`thing-listing-item${selectedThing?.id === thing.id ? " is-selected" : ""}`}
                  href={`/app?thing=${thing.id}`}
                  key={thing.id}
                >
                  <div className="thing-listing-head">
                    <span className={`status-pill status-${thing.status}`}>{thing.status}</span>
                    <span className={`escalation-pill escalation-${thing.escalation}`}>{thing.escalation}</span>
                  </div>
                  <strong>{thing.title}</strong>
                  <p>{thing.summary}</p>
                </Link>
              ))}
            </div>
          </div>
        </aside>

        <section className="workspace-detail">
          {selectedThing ? (
            <>
              <div className="workspace-detail-header">
                <div>
                  <div className="workspace-badges">
                    <span className={`escalation-pill escalation-${selectedThing.escalation}`}>{selectedThing.escalation}</span>
                    <span className={`status-pill status-${selectedThing.status}`}>{selectedThing.status}</span>
                    <span className="kind-pill">{selectedThing.kind}</span>
                  </div>
                  <h1>{selectedThing.title}</h1>
                  <p className="workspace-summary">{selectedThing.summary}</p>
                </div>

                <dl className="workspace-meta">
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatTimestamp(selectedThing.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>Backed by</dt>
                    <dd>{`.humanctl/tabs/${selectedThing.tabId}/things/${selectedThing.id}`}</dd>
                  </div>
                  <div>
                    <dt>Attachments</dt>
                    <dd>{selectedThing.attachments?.length ?? 0}</dd>
                  </div>
                </dl>
              </div>

              {selectedThing.response?.type === "single-select" && selectedThing.needsResponse ? (
                <section className="workspace-response">
                  <div className="workspace-panel-header">
                    <p className="workspace-label">Needs response</p>
                    <span className="workspace-pill">human input</span>
                  </div>
                  <h2>{selectedThing.response.prompt}</h2>
                  <form action={submitThingResponse} className="response-form">
                    <input name="tabId" type="hidden" value={selectedThing.tabId} />
                    <input name="thingId" type="hidden" value={selectedThing.id} />

                    <label className="response-note">
                      Add context if needed
                      <textarea name="note" placeholder="Optional note to future sessions." rows={3} />
                    </label>

                    <div className="response-options">
                      {selectedThing.response.options.map((option) => (
                        <button className="response-option" key={option.id} name="choiceId" type="submit" value={option.id}>
                          <div className="response-option-head">
                            <strong>{option.label}</strong>
                            {option.recommended ? <span className="workspace-pill">recommended</span> : null}
                          </div>
                          <span>{option.description}</span>
                        </button>
                      ))}
                    </div>
                  </form>
                </section>
              ) : null}

              {selectedThing.response?.answer ? (
                <section className="workspace-response workspace-response-static">
                  <div className="workspace-panel-header">
                    <p className="workspace-label">Last answer</p>
                    <span className="workspace-pill">{selectedThing.response.answer.actor}</span>
                  </div>
                  <h2>{chosenOption?.label ?? selectedThing.response.answer.choiceId}</h2>
                  <p>{chosenOption?.description}</p>
                  {selectedThing.response.answer.note ? <p className="response-note-copy">{selectedThing.response.answer.note}</p> : null}
                  <p className="workspace-response-time">Answered {formatTimestamp(selectedThing.response.answer.answeredAt)}</p>
                </section>
              ) : null}

              <section className="workspace-render">
                <div className="workspace-panel-header">
                  <p className="workspace-label">Rendered content</p>
                  <span className="workspace-pill">{selectedThing.render.type}</span>
                </div>
                <div className="workspace-html" dangerouslySetInnerHTML={{ __html: selectedThing.content }} />
              </section>
            </>
          ) : (
            <section className="workspace-empty">
              <p className="workspace-label">Empty</p>
              <h1>No Things yet</h1>
              <p>Create a Thing under `.humanctl/tabs/main/things` and reload.</p>
            </section>
          )}
        </section>

        <aside className="workspace-sidepanel">
          <section className="workspace-panel">
            <div className="workspace-panel-header">
              <p className="workspace-label">Inbox</p>
              <span className="workspace-pill">{events.length}</span>
            </div>
            <ol className="activity-list">
              {events.map((event) => (
                <li className="activity-item" key={event.id}>
                  <div className="activity-head">
                    <span>{event.kind}</span>
                    <time>{formatTimestamp(event.ts)}</time>
                  </div>
                  <p>{eventCopy(event, thingMap)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="workspace-panel">
            <div className="workspace-panel-header">
              <p className="workspace-label">State</p>
              <span className="workspace-pill">file-backed</span>
            </div>
            <dl className="workspace-facts">
              <div>
                <dt>Workspace root</dt>
                <dd>.humanctl/</dd>
              </div>
              <div>
                <dt>Selected tab</dt>
                <dd>{tab.id}</dd>
              </div>
              <div>
                <dt>Answered items</dt>
                <dd>{answeredCount}</dd>
              </div>
              <div>
                <dt>Default route</dt>
                <dd>/app</dd>
              </div>
            </dl>
          </section>
        </aside>
      </section>
    </main>
  );
}
