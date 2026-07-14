import { Fragment, useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react"
import {
  BotIcon,
  CircleAlertIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  HistoryIcon,
  LoaderCircleIcon,
  PinIcon,
  PlayIcon,
  RefreshCwIcon,
  SparklesIcon,
  UserIcon,
  WrenchIcon,
} from "lucide-react"

import { Composer } from "@humanctl/ui/blocks/composer"
import { DetailPane } from "@humanctl/ui/blocks/detail-pane"
import { Button } from "@humanctl/ui/components/button"
import { IconButton } from "@humanctl/ui/components/icon-button"
import { Skeleton } from "@humanctl/ui/components/skeleton"

import type {
  HumanctlApplicationModel,
  HumanctlAnswerResult,
  HumanctlDispatch,
  HumanctlInboxThread,
  HumanctlSession,
  HumanctlThreadItem,
  HumanctlTimelineEvent,
} from "./contracts"
import { formatTime, operationPending, sessionRepo, sessionTitle, stateLabel } from "./helpers"
import { EmptyState, HarnessMark, SectionHeading, SessionStatus } from "./shared"

type SessionDetailProps = {
  model: HumanctlApplicationModel
  dispatch: HumanctlDispatch
  session: HumanctlSession | null
  thread?: HumanctlInboxThread | null
  onClose?: () => void
}

function itemLabel(item: HumanctlThreadItem): string {
  if (item.kind === "note") return item.level
  if (item.kind === "ask") return "Question for you"
  if (item.kind === "ask-interrupted") return "Interrupted question"
  if (item.kind === "qa") return "Session answer"
  return "Your answer"
}

function itemBody(item: HumanctlThreadItem) {
  if (item.kind === "note") return <p>{item.message}</p>
  if (item.kind === "ask") return <p>{item.reason}</p>
  if (item.kind === "ask-interrupted") return <p>{item.question || "The session stopped before the question was recorded."}</p>
  if (item.kind === "answer") return <p>{item.text}</p>
  return (
    <div className="space-y-2">
      <p className="text-ink-3">You asked: {item.question}</p>
      <p className="whitespace-pre-wrap">{item.answer}</p>
    </div>
  )
}

function deliveryLabel(item: HumanctlThreadItem): string | undefined {
  if (item.kind !== "answer") return undefined
  if (item.delivery === "codex-rollout") return "Delivered to the task transcript"
  if (item.delivery === "staged") return "Staged for clipboard and terminal delivery"
  if (item.delivery === "file") return "Recorded in the inbox file only"
  return undefined
}

type LocalAnswer = {
  item: Extract<HumanctlThreadItem, { kind: "answer" }>
  result: HumanctlAnswerResult
}

function sameAnswer(left: Extract<HumanctlThreadItem, { kind: "answer" }>, right: HumanctlThreadItem): boolean {
  if (right.kind !== "answer" || left.text.trim() !== right.text.trim()) return false
  if (left.askId && right.askId) return left.askId === right.askId
  const leftAt = Date.parse(left.ts)
  const rightAt = Date.parse(right.ts)
  return Number.isFinite(leftAt) && Number.isFinite(rightAt) && Math.abs(leftAt - rightAt) <= 5 * 60_000
}

function DeliveryReceipt({ result }: { result: HumanctlAnswerResult }) {
  const details: Array<{ text: string; failed?: boolean }> = []
  if (result.delivery === "codex-rollout") details.push({ text: result.delivered === false ? "Task transcript delivery failed" : "Delivered to the task transcript", failed: result.delivered === false })
  if (result.delivery === "staged") details.push({ text: "Staged for clipboard and terminal delivery" })
  if (result.delivery === "file") details.push({ text: "Recorded in the inbox file only" })
  if (result.clipped) details.push({ text: "Reply was clipped to the delivery limit", failed: true })
  if (result.needsAck) details.push({ text: "Task transcript write acknowledgement is required", failed: true })
  if (result.resumed) details.push({ text: "Session resumed" })
  if (result.deliverError) details.push({ text: `Delivery failed: ${result.deliverError}`, failed: true })
  if (result.clipboardError) details.push({ text: `Clipboard copy failed: ${result.clipboardError}`, failed: true })
  if (result.resumeError) details.push({ text: `Resume failed: ${result.resumeError}`, failed: true })
  if (result.error) details.push({ text: result.error, failed: true })
  if (details.length === 0) return null
  return (
    <div className="mt-1.5 space-y-0.5 font-mono text-[10px]" aria-live="polite">
      {details.map((detail, index) => <div key={`${detail.text}-${index}`} className={detail.failed ? "text-block" : "text-ink-4"}>{detail.text}</div>)}
    </div>
  )
}

function ThreadStream({
  items,
  session,
  dispatch,
  operations,
  codexAcknowledged,
}: {
  items: ReadonlyArray<HumanctlThreadItem>
  session: HumanctlSession
  dispatch: HumanctlDispatch
  operations: HumanctlApplicationModel["operations"]
  codexAcknowledged: boolean
}) {
  const [answer, setAnswer] = useState("")
  const [localAnswers, setLocalAnswers] = useState<LocalAnswer[]>([])
  const [submissionError, setSubmissionError] = useState<string | null>(null)
  const pending = operationPending(operations, `ask.answer:${session.id}`)
  const operationError = operations[`ask.answer:${session.id}`]?.error
  const replyAllowed = session.state === "need" || session.state === "block"
  const visibleLocalAnswers = localAnswers.filter((local) => !items.some((item) => sameAnswer(local.item, item)))
  const combined = [
    ...items.map((item) => ({ item, result: undefined as HumanctlAnswerResult | undefined })),
    ...visibleLocalAnswers.map((local) => ({ item: local.item as HumanctlThreadItem, result: local.result })),
  ]
  let pendingAskIndex = -1
  combined.forEach(({ item }, index) => {
    if (item.kind === "ask") pendingAskIndex = index
    if (item.kind === "answer" && pendingAskIndex >= 0) pendingAskIndex = -1
  })

  async function submitAnswer() {
    const text = answer.trim()
    if (!text || pending) return
    setSubmissionError(null)
    const outcome = await dispatch({ type: "ask.answer", session, text })
    if (!outcome.ok) {
      setSubmissionError(outcome.error)
      return
    }
    const result = outcome.value as HumanctlAnswerResult
    if (!result || result.ok === false) {
      setSubmissionError(result?.error || result?.deliverError || (result?.needsAck ? "Acknowledge task transcript writes before replying." : "The reply was not delivered."))
      return
    }
    setLocalAnswers((current) => [...current, { item: {
      kind: "answer",
      text,
      delivery: result.delivery,
      actor: "human",
      ts: new Date(result.at || Date.now()).toISOString(),
    }, result }])
    setAnswer("")
  }

  if (combined.length === 0) {
    return <p className="px-4 py-5 text-[13px] text-ink-3">No inbox updates for this task.</p>
  }

  return (
    <div className="border-t border-border">
      {combined.map(({ item, result }, index) => (
        <Fragment key={`${item.kind}-${item.ts}-${index}`}>
          <article className="border-b border-border px-4 py-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-ink-3">{itemLabel(item)}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-4">{formatTime(item.ts)}</span>
            </div>
            <div className="whitespace-pre-wrap text-[13px] leading-5 text-ink-2">{itemBody(item)}</div>
            {result ? <DeliveryReceipt result={result} /> : deliveryLabel(item) ? <div className="mt-1.5 font-mono text-[10px] text-ink-4">{deliveryLabel(item)}</div> : null}
          </article>
          {index === pendingAskIndex ? (
            <div className="border-b border-border px-4 py-3">
              {replyAllowed ? (
                <>
                  <Composer
                    value={answer}
                    onValueChange={setAnswer}
                    onSubmit={() => { void submitAnswer() }}
                    placeholder="Answer this question"
                    submitLabel="Answer"
                    disabled={pending || !codexAcknowledged}
                    submitting={pending}
                    hint="Command or Control + Enter"
                  />
                  {submissionError || operationError ? <p className="mt-2 text-[12px] leading-5 text-block">{submissionError || operationError}</p> : null}
                </>
              ) : <p className="text-[12px] leading-5 text-ink-3">Reply is unavailable while this task is {stateLabel(session.state).toLowerCase()}.</p>}
            </div>
          ) : null}
        </Fragment>
      ))}
    </div>
  )
}

function CodexWriteDisclosure({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <div className="mb-2 border-l-2 border-need bg-need-soft px-3 py-2 text-[12px] leading-5 text-ink-2">
      <p>Codex questions and replies are appended to the original task transcript. Humanctl refuses while that task is actively running.</p>
      <Button size="sm" variant="ghost" className="mt-1.5" onClick={onAcknowledge}>I understand and enable</Button>
    </div>
  )
}

function TimelineEventRow({ event }: { event: HumanctlTimelineEvent }) {
  const isTool = event.k === "tools"
  const Icon = isTool ? WrenchIcon : event.k === "user" ? UserIcon : event.k === "interrupt" ? CircleAlertIcon : BotIcon
  const label = isTool ? `${event.n} tool call${event.n === 1 ? "" : "s"}` : event.k === "user" ? "You" : event.k === "interrupt" ? "Interrupted" : "Agent"
  return (
    <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-2 border-b border-border px-4 py-2.5">
      <span className="mt-0.5 grid size-5 place-items-center text-ink-4"><Icon className="size-3.5" /></span>
      <div className="min-w-0">
        <div className="font-mono text-[10px] font-medium uppercase tracking-[0.06em] text-ink-3">{label}</div>
        {!isTool ? <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-5 text-ink-2">{event.t || "No text recorded"}</p> : null}
      </div>
      <span className="font-mono text-[10px] text-ink-4">{formatTime(event.ts)}</span>
    </div>
  )
}

function Timeline({
  model,
  dispatch,
  session,
  onLoadOlder,
}: Pick<SessionDetailProps, "model" | "dispatch"> & { session: HumanctlSession; onLoadOlder: () => void }) {
  const resource = model.resources.timeline
  const timeline = resource.data?.session.id === session.id ? resource.data : null

  if (resource.status === "loading" && (!timeline || timeline.items.length === 0)) {
    return (
      <div className="space-y-px border-t border-border px-4 py-3" role="status" aria-label="Loading conversation">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (resource.error && !timeline) {
    return (
      <div className="px-4 py-5 text-[13px] text-block">
        <p>{resource.error}</p>
        <Button size="sm" className="mt-3" onClick={() => { void dispatch({ type: "timeline.open", session }) }}>
          <RefreshCwIcon /> Retry
        </Button>
      </div>
    )
  }

  if (!timeline || timeline.items.length === 0) {
    return <p className="px-4 py-5 text-[13px] text-ink-3">No conversation events were found.</p>
  }

  return (
    <div className="border-t border-border">
      {!timeline.atStart ? (
        <div className="flex h-10 items-center justify-center border-b border-border">
          <Button
            size="sm"
            variant="ghost"
            disabled={timeline.loadingOlder}
            onClick={onLoadOlder}
          >
            {timeline.loadingOlder ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <HistoryIcon />}
            {timeline.estEarlier ? `Load about ${timeline.estEarlier} earlier` : "Load older"}
          </Button>
        </div>
      ) : null}
      {timeline.items.map((item) => <TimelineEventRow key={item.key} event={item.event} />)}
      <div className="flex h-8 items-center gap-2 px-4 font-mono text-[10px] text-ink-4">
        <span className={timeline.live ? "text-work" : undefined}>{timeline.live ? "Live" : "Snapshot"}</span>
        {resource.error ? <span className="text-block">Updates degraded</span> : null}
        {timeline.capped ? <span>Newest 600 events shown</span> : null}
      </div>
    </div>
  )
}

export function SessionDetail({ model, dispatch, session, thread, onClose }: SessionDetailProps) {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [askFailure, setAskFailure] = useState<string | null>(null)
  const [summaryFailure, setSummaryFailure] = useState<string | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)
  const nearBottomRef = useRef(false)
  const prependSnapshotRef = useRef<{ sessionId: string; scrollHeight: number; scrollTop: number } | null>(null)
  const previousTimelineSequenceRef = useRef<number | null>(null)
  const appState = model.resources.appState.data
  const pinned = session ? appState.pins.includes(session.id) : false
  const timeline = session && model.resources.timeline.data?.session.id === session.id ? model.resources.timeline.data : null
  const timelineIdentity = session?.path ? `${session.id}\u0000${session.path}\u0000${session.harness}` : null

  const openCurrentTimeline = useEffectEvent(() => {
    if (!session?.path) return
    void dispatch({ type: "timeline.open", session })
  })

  useEffect(() => {
    if (!timelineIdentity) return
    openCurrentTimeline()
    return () => { void dispatch({ type: "timeline.close" }) }
  }, [dispatch, timelineIdentity])

  useLayoutEffect(() => {
    const viewport = detailRef.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']")
    if (!viewport) return
    const recordPosition = () => {
      nearBottomRef.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48
    }
    recordPosition()
    viewport.addEventListener("scroll", recordPosition, { passive: true })
    return () => viewport.removeEventListener("scroll", recordPosition)
  }, [session?.id])

  useLayoutEffect(() => {
    if (!timeline || previousTimelineSequenceRef.current === timeline.changeSeq) return
    const viewport = detailRef.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']")
    if (!viewport) return
    const wasNearBottom = nearBottomRef.current
    const snapshot = prependSnapshotRef.current
    if (timeline.changeKind === "prepend" && snapshot?.sessionId === timeline.session.id) {
      viewport.scrollTop = snapshot.scrollTop + Math.max(0, viewport.scrollHeight - snapshot.scrollHeight)
      prependSnapshotRef.current = null
    } else if (timeline.changeKind === "append" && wasNearBottom) {
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    }
    previousTimelineSequenceRef.current = timeline.changeSeq
    nearBottomRef.current = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 48
  }, [timeline?.changeSeq, timeline])

  const loadOlder = useCallback(async () => {
    if (!session) return
    const viewport = detailRef.current?.querySelector<HTMLElement>("[data-slot='scroll-area-viewport']")
    if (viewport) prependSnapshotRef.current = { sessionId: session.id, scrollHeight: viewport.scrollHeight, scrollTop: viewport.scrollTop }
    const outcome = await dispatch({ type: "timeline.loadOlder" })
    if (!outcome.ok) prependSnapshotRef.current = null
  }, [dispatch, session])

  if (!session) {
    return (
      <div className="h-full border-l border-border">
        <EmptyState title="Select a task" description="Choose a row to inspect its updates, transcript, context, and available actions." />
      </div>
    )
  }

  const activeSession = session

  const asking = operationPending(model.operations, `session.ask:${activeSession.id}`)
  const summarizing = operationPending(model.operations, `session.summarize:${activeSession.id}`)
  const resuming = operationPending(model.operations, `session.resume:${activeSession.id}`)
  const askError = askFailure || model.operations[`session.ask:${activeSession.id}`]?.error
  const summaryError = summaryFailure || model.operations[`session.summarize:${activeSession.id}`]?.error
  const resumeError = model.operations[`session.resume:${activeSession.id}`]?.error
  const codexAcknowledged = activeSession.harness !== "codex" || appState.askCodexAck === true
  const items = thread?.items || []

  function acknowledgeCodexWrites() {
    void dispatch({ type: "app.patch", patch: { askCodexAck: true } })
  }

  async function ask() {
    const value = question.trim()
    if (!value || asking) return
    setAskFailure(null)
    const outcome = await dispatch({ type: "session.ask", session: activeSession, question: value })
    if (!outcome.ok) {
      setAskFailure(outcome.error)
      return
    }
    const result = outcome.value as { answer?: string }
    if (!result.answer?.trim()) {
      setAskFailure("No answer was returned.")
      return
    }
    setAnswer(result.answer)
    setQuestion("")
  }

  async function summarize() {
    setSummaryFailure(null)
    const outcome = await dispatch({ type: "session.summarize", session: activeSession })
    if (!outcome.ok) {
      setSummaryFailure(outcome.error)
      return
    }
    const result = outcome.value as { summary?: string }
    if (!result.summary?.trim()) {
      setSummaryFailure("No summary was returned.")
      return
    }
    setSummary(result.summary)
  }

  return (
    <DetailPane
      ref={detailRef}
      data-session-id={session.id}
      title={sessionTitle(session)}
      eyebrow={<span className="flex items-center gap-2"><HarnessMark harness={session.harness} />{sessionRepo(session)}</span>}
      meta={[session.model, session.reasoningEffort, session.age].filter(Boolean).join(" · ")}
      onClose={onClose}
      actions={
        <>
          <IconButton
            aria-label={pinned ? "Unpin task" : "Pin task"}
            size="sm"
            variant="ghost"
            className={pinned ? "text-primary" : undefined}
            onClick={() => { void dispatch({ type: "session.togglePin", id: session.id }) }}
          >
            <PinIcon className={pinned ? "fill-current" : undefined} />
          </IconButton>
          {session.path ? (
            <IconButton aria-label="Reveal transcript" size="sm" variant="ghost" onClick={() => { void dispatch({ type: "session.reveal", path: session.path! }) }}>
              <FolderOpenIcon />
            </IconButton>
          ) : null}
          <Button size="sm" variant="primary" disabled={resuming} onClick={() => { void dispatch({ type: "session.resume", session }) }}>
            {resuming ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <PlayIcon />}
            Resume
          </Button>
        </>
      }
      footer={
        <div className="space-y-2">
          {!codexAcknowledged ? <CodexWriteDisclosure onAcknowledge={acknowledgeCodexWrites} /> : null}
          {answer ? (
            <div className="max-h-28 overflow-y-auto border-l-2 border-primary pl-3 text-[12px] leading-5 text-ink-2">
              <div className="mb-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">Session answer</div>
              <p className="whitespace-pre-wrap">{answer}</p>
            </div>
          ) : null}
          <Composer
            value={question}
            onValueChange={setQuestion}
            onSubmit={() => { void ask() }}
            placeholder="Ask this session"
            submitLabel="Ask"
            submitting={asking}
            disabled={asking || !codexAcknowledged}
          />
          {askError ? <p className="text-[12px] leading-5 text-block">{askError}</p> : null}
        </div>
      }
    >
      <div className="-mx-4 -my-4">
        <div className="flex min-h-11 items-center gap-3 border-b border-border px-4">
          <SessionStatus state={session.state} />
          <span className="truncate text-[12px] text-ink-3">{session.stateReason || "No status reason recorded"}</span>
          {session.contextPct != null ? <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">{Math.round(session.contextPct)}% context</span> : null}
        </div>
        {resumeError ? <div className="border-b border-border bg-block-soft px-4 py-2 text-[12px] leading-5 text-block">Resume failed: {resumeError}</div> : null}

        <SectionHeading trailing={
          <Button size="sm" variant="ghost" disabled={summarizing} onClick={() => { void summarize() }}>
            {summarizing ? <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" /> : <SparklesIcon />}
            Summarize
          </Button>
        }>
          Summary
        </SectionHeading>
        <div className="border-b border-border px-4 py-3 text-[13px] leading-5 text-ink-2">
          {summary || session.summary?.text || session.prevAgent || "No summary has been generated for this task."}
          {session.summary?.engine && !summary ? <div className="mt-1 font-mono text-[10px] text-ink-4">Generated by {session.summary.engine}</div> : null}
          {summaryError ? <div className="mt-2 text-[12px] text-block">Summary failed: {summaryError}</div> : null}
        </div>

        <SectionHeading>Inbox thread</SectionHeading>
        <ThreadStream
          key={activeSession.id}
          items={items}
          session={activeSession}
          dispatch={dispatch}
          operations={model.operations}
          codexAcknowledged={codexAcknowledged}
        />

        <SectionHeading trailing={model.resources.timeline.data?.live ? <span className="font-mono text-[10px] text-work">Live</span> : null}>
          Conversation
        </SectionHeading>
        <Timeline model={model} dispatch={dispatch} session={session} onLoadOlder={() => { void loadOlder() }} />

        <SectionHeading>Task facts</SectionHeading>
        <div className="divide-y divide-border text-[12px]">
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-2"><span className="text-ink-3">Task ID</span><code className="truncate font-mono text-[11px] text-ink-2">{session.id}</code></div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-2"><span className="text-ink-3">Workspace</span><span className="truncate text-ink-2">{session.cwd || session.repo || "Unknown"}</span></div>
          {session.path ? <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-2"><span className="text-ink-3">Transcript</span><button type="button" className="flex min-w-0 items-center gap-1 truncate rounded-[var(--radius-1)] text-left text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" onClick={() => { void dispatch({ type: "session.reveal", path: session.path! }) }}><span className="truncate">{session.path}</span><ExternalLinkIcon className="size-3 shrink-0" /></button></div> : null}
        </div>
      </div>
    </DetailPane>
  )
}
