import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  CUSTOM_NOTE_CHOICE_ID,
  readWorkspace,
  type Ask,
  type Artifact,
  type AskResponseOption,
  type WorkspaceEvent,
  type WatchManifest
} from "@/lib/humanctl";
import { submitAskResponse } from "./actions";

export const dynamic = "force-dynamic";

function formatTimestamp(ts?: string) {
  if (!ts) {
    return "not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(ts));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function eventCopy(
  event: WorkspaceEvent,
  asksById: Map<string, Ask>,
  artifactsById: Map<string, Artifact>,
  watchesById: Map<string, WatchManifest>
) {
  if (event.target.type === "ask") {
    return asksById.get(event.target.id)?.title ?? event.target.id;
  }

  if (event.target.type === "artifact") {
    return artifactsById.get(event.target.id)?.title ?? event.target.id;
  }

  return watchesById.get(event.target.id)?.title ?? event.target.id;
}

function eventLine(
  event: WorkspaceEvent,
  asksById: Map<string, Ask>,
  artifactsById: Map<string, Artifact>,
  watchesById: Map<string, WatchManifest>
) {
  const title = eventCopy(event, asksById, artifactsById, watchesById);

  switch (event.kind) {
    case "answered":
      return `Human answered ${title}`;
    case "published":
      return `Published ${title}`;
    case "watch_created":
      return `Started watch ${title}`;
    case "created":
      return `Created ${title}`;
    default:
      return `${event.kind} ${title}`;
  }
}

function optionById(options: AskResponseOption[] | undefined, choiceId: string | undefined) {
  return options?.find((option) => option.id === choiceId);
}

function interruptLabel(ask?: Ask) {
  if (!ask) {
    return "Waiting";
  }

  switch (ask.escalation) {
    case "block":
      return "Blocked on you";
    case "ask":
      return "Need your answer";
    case "nudge":
      return "Quick steer";
    default:
      return "For your awareness";
  }
}

type SearchParams = Promise<{
  ask?: string | string[];
  artifact?: string | string[];
}>;

export default async function WorkspacePage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const requestedAskId = Array.isArray(params.ask) ? params.ask[0] : params.ask;
  const requestedArtifactId = Array.isArray(params.artifact) ? params.artifact[0] : params.artifact;
  const { workspace, asks, artifacts, watches, events } = await readWorkspace();

  const selectedAsk =
    asks.find((ask) => ask.id === requestedAskId) ??
    asks.find((ask) => ask.status === "blocked") ??
    asks.find((ask) => ask.status === "open") ??
    asks[0];

  const asksById = new Map(asks.map((ask) => [ask.id, ask]));
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const watchesById = new Map(watches.map((watch) => [watch.id, watch]));

  const linkedArtifacts = (selectedAsk?.artifactIds ?? []).map((artifactId) => artifactsById.get(artifactId)).filter(isDefined);
  const workingCanvas = artifacts;
  const selectedArtifact =
    (requestedArtifactId ? artifactsById.get(requestedArtifactId) : undefined) ??
    linkedArtifacts[0] ??
    workingCanvas[0];

  const openCount = asks.filter((ask) => ask.status === "open" || ask.status === "blocked").length;
  const chosenOption = optionById(selectedAsk?.response.options, selectedAsk?.response.answer?.choiceId);
  const secondaryAsks = asks.filter((ask) => ask.id !== selectedAsk?.id);
  const recentEvents = events.slice(0, 5);
  const focusLabel = interruptLabel(selectedAsk);

  return (
    <main className="interrupt-page">
      <div className="grain" aria-hidden="true" />

      <header className="interrupt-topbar">
        <div className="interrupt-brand">
          <div className="brand">
            <span className="brand-mark">hctl</span>
            <div>
              <span className="brand-name">humanctl</span>
              <p className="interrupt-subtitle">An attention router for a scarce human · {workspace.name}</p>
            </div>
          </div>
          <p className="interrupt-statusline">
            {openCount} active asks · {secondaryAsks.length} waiting · {linkedArtifacts.length} attached
          </p>
        </div>

        <div className="interrupt-actions">
          <Link className="interrupt-link" href="/">
            Site
          </Link>
          <a className="interrupt-link" href="https://github.com/danielgwilson/humanctl" rel="noreferrer" target="_blank">
            GitHub
          </a>
          <ThemeToggle />
        </div>
      </header>

      {selectedAsk ? (
        <>
          <section className="interrupt-hero">
            <div className="stage-window interrupt-stage-window">
              <div className="window-chrome">
                <span />
                <span />
                <span />
                <div className="interrupt-window-meta">
                  <b>{focusLabel}</b>
                  <b>{secondaryAsks.length} waiting</b>
                  <b>{linkedArtifacts.length} attached</b>
                </div>
              </div>

              <div className="interrupt-stage-body">
                <section className="interrupt-brief">
                  <p className="interrupt-overline">{selectedAsk.title}</p>
                  <h1>{selectedAsk.prompt}</h1>
                  <p className="interrupt-summary">{selectedAsk.summary}</p>

                  {(selectedAsk.whyNow || selectedAsk.ifIgnored) && (
                    <dl className="interrupt-brief-facts">
                      {selectedAsk.whyNow ? (
                        <div>
                          <dt>Why now</dt>
                          <dd>{selectedAsk.whyNow}</dd>
                        </div>
                      ) : null}
                      {selectedAsk.ifIgnored ? (
                        <div>
                          <dt>If ignored</dt>
                          <dd>{selectedAsk.ifIgnored}</dd>
                        </div>
                      ) : null}
                    </dl>
                  )}
                </section>

                <section className="interrupt-responder">
                  {selectedAsk.response.type === "single-select" && !selectedAsk.response.answer ? (
                    <form action={submitAskResponse} className="interrupt-response-form">
                      <input name="askId" type="hidden" value={selectedAsk.id} />

                      <div className="interrupt-responder-head">
                        <div>
                          <p className="interrupt-section-label">Reply here</p>
                          <h2>Choose a steer or write back.</h2>
                        </div>
                        <span className="interrupt-helper">Writes back into `.humanctl`.</span>
                      </div>

                      <div className="interrupt-option-list">
                        {selectedAsk.response.options.map((option) => (
                          <button className="interrupt-option-row" key={option.id} name="choiceId" type="submit" value={option.id}>
                            <div className="interrupt-option-copy">
                              <strong>{option.label}</strong>
                              <span>{option.description}</span>
                            </div>
                            {option.recommended ? <span className="interrupt-recommendation">Recommended</span> : null}
                          </button>
                        ))}
                      </div>

                      <div className="interrupt-writeback">
                        <label className="interrupt-writeback-field">
                          <span>None of these / add context</span>
                          <textarea
                            name="note"
                            placeholder="Still meh. Condense and concentrate attention harder. Let me expand detail only when I want it."
                            rows={3}
                          />
                        </label>
                        <button className="interrupt-note-submit" type="submit">
                          Send note
                        </button>
                      </div>

                      {linkedArtifacts.length > 0 ? (
                        <div className="interrupt-context-strip">
                          <span className="interrupt-context-label">Context</span>
                          {linkedArtifacts.map((artifact) => (
                            <Link
                              className={`interrupt-context-link${selectedArtifact?.id === artifact.id ? " is-selected" : ""}`}
                              href={`/app?ask=${selectedAsk.id}&artifact=${artifact.id}`}
                              key={artifact.id}
                            >
                              {artifact.title}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </form>
                  ) : null}

                  {selectedAsk.response.answer ? (
                    <div className="interrupt-answer-state">
                      <div className="interrupt-responder-head">
                        <div>
                          <p className="interrupt-section-label">Latest answer</p>
                          <h2>
                            {chosenOption?.label ??
                              (selectedAsk.response.answer.choiceId === CUSTOM_NOTE_CHOICE_ID
                                ? "Detailed note"
                                : selectedAsk.response.answer.choiceId)}
                          </h2>
                        </div>
                        <span className="interrupt-helper">Answered {formatTimestamp(selectedAsk.response.answer.answeredAt)}</span>
                      </div>
                      {chosenOption?.description ? <p className="interrupt-answer-copy">{chosenOption.description}</p> : null}
                      {selectedAsk.response.answer.note ? <p className="interrupt-answer-note">{selectedAsk.response.answer.note}</p> : null}

                      {linkedArtifacts.length > 0 ? (
                        <div className="interrupt-context-strip">
                          <span className="interrupt-context-label">Context</span>
                          {linkedArtifacts.map((artifact) => (
                            <Link
                              className={`interrupt-context-link${selectedArtifact?.id === artifact.id ? " is-selected" : ""}`}
                              href={`/app?ask=${selectedAsk.id}&artifact=${artifact.id}`}
                              key={artifact.id}
                            >
                              {artifact.title}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </div>
            </div>
          </section>

          {selectedArtifact ? (
            <section className="interrupt-artifact-shell">
              <div className="interrupt-artifact-head">
                <div>
                  <p className="interrupt-section-label">What I’m showing you</p>
                  <h2>{selectedArtifact.title}</h2>
                  <p className="interrupt-artifact-summary">{selectedArtifact.summary}</p>
                </div>
                <div className="interrupt-artifact-tags">
                  <span>{selectedArtifact.kind}</span>
                  {(selectedArtifact.labels ?? []).map((label) => (
                    <span key={label}>
                      {label}
                    </span>
                  ))}
                </div>
              </div>

              <div className="stage-window interrupt-artifact-window">
                <div className="window-chrome">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="interrupt-artifact-frame">
                  <div className="workspace-html" dangerouslySetInnerHTML={{ __html: selectedArtifact.content }} />
                </div>
              </div>
            </section>
          ) : null}

          <section className="interrupt-footnotes">
            {secondaryAsks.length > 0 ? (
              <details className="interrupt-detail-group">
                <summary>Other asks can wait</summary>
                <div className="interrupt-detail-links">
                  {secondaryAsks.map((ask) => (
                    <Link className="interrupt-detail-link" href={`/app?ask=${ask.id}`} key={ask.id}>
                      {ask.title}
                    </Link>
                  ))}
                </div>
              </details>
            ) : null}

            {watches.length > 0 ? (
              <details className="interrupt-detail-group">
                <summary>{watches.length} background watches</summary>
                <div className="interrupt-detail-links">
                  {watches.map((watch) => (
                    <div className="interrupt-detail-link is-static" key={watch.id}>
                      {watch.title}
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {recentEvents.length > 0 ? (
              <details className="interrupt-detail-group">
                <summary>Recent activity</summary>
                <ol className="interrupt-activity-list">
                  {recentEvents.map((event) => (
                    <li className="interrupt-activity-item" key={event.id}>
                      <p>{eventLine(event, asksById, artifactsById, watchesById)}</p>
                      <time>{formatTimestamp(event.ts)}</time>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
          </section>
        </>
      ) : (
        <section className="workspace-empty">
          <p className="workspace-label">Empty</p>
          <h1>No asks yet</h1>
          <p>Create an ask under `.humanctl/asks/` and reload.</p>
        </section>
      )}
    </main>
  );
}
