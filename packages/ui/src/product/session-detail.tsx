import { useEffect, useEffectEvent, useState } from "react"
import {
  ExternalLinkIcon,
  FolderOpenIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlayIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"

import { Composer } from "@humanctl/ui/blocks/composer"
import { ConversationMarker, ConversationMessage } from "@humanctl/ui/blocks/conversation"
import { DetailPane } from "@humanctl/ui/blocks/detail-pane"
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@humanctl/ui/components/alert"
import { Button } from "@humanctl/ui/components/button"
import { IconButton } from "@humanctl/ui/components/icon-button"
import { Menu, MenuContent, MenuGroup, MenuItem, MenuTrigger } from "@humanctl/ui/components/menu"
import { MessageScrollerItem } from "@humanctl/ui/components/message-scroller"
import { Skeleton } from "@humanctl/ui/components/skeleton"
import { Spinner } from "@humanctl/ui/components/spinner"

import type {
  HumanctlApplicationModel,
  HumanctlAnswerResult,
  HumanctlDispatch,
  HumanctlInboxThread,
  HumanctlSession,
  HumanctlThreadItem,
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
    <div className="flex flex-col gap-2">
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

type ThreadEntry = {
  item: HumanctlThreadItem
  result?: HumanctlAnswerResult
}

function sameAnswer(left: Extract<HumanctlThreadItem, { kind: "answer" }>, right: HumanctlThreadItem): boolean {
  if (right.kind !== "answer" || left.text.trim() !== right.text.trim()) return false
  if (left.askId && right.askId) return left.askId === right.askId
  const leftAt = Date.parse(left.ts)
  const rightAt = Date.parse(right.ts)
  return Number.isFinite(leftAt) && Number.isFinite(rightAt) && Math.abs(leftAt - rightAt) <= 5 * 60_000
}

function combineThreadEntries(items: ReadonlyArray<HumanctlThreadItem>, localAnswers: ReadonlyArray<LocalAnswer>): ThreadEntry[] {
  const visibleLocalAnswers = localAnswers.filter((local) => !items.some((item) => sameAnswer(local.item, item)))
  return [
    ...items.map((item) => ({ item })),
    ...visibleLocalAnswers.map((local) => ({ item: local.item as HumanctlThreadItem, result: local.result })),
  ].sort((left, right) => Date.parse(left.item.ts) - Date.parse(right.item.ts))
}

function pendingAskFrom(entries: ReadonlyArray<ThreadEntry>): Extract<HumanctlThreadItem, { kind: "ask" }> | null {
  let pending: Extract<HumanctlThreadItem, { kind: "ask" }> | null = null
  for (const { item } of entries) {
    if (item.kind === "ask") pending = item
    if (item.kind === "answer") pending = null
  }
  return pending
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
    <div className="flex flex-col gap-0.5 font-mono text-[11px]" aria-live="polite">
      {details.map((detail, index) => <div key={`${detail.text}-${index}`} className={detail.failed ? "text-block" : "text-ink-4"}>{detail.text}</div>)}
    </div>
  )
}

function ThreadStream({
  entries,
}: {
  entries: ReadonlyArray<ThreadEntry>
}) {
  if (entries.length === 0) {
    return (
      <MessageScrollerItem messageId="inbox-empty" className="border-b border-border px-4 py-5 text-[13px] text-ink-3">
        No inbox updates for this task.
      </MessageScrollerItem>
    )
  }

  return (
    <>
      {entries.map(({ item, result }, index) => (
        <ConversationMessage
          key={`${item.kind}-${item.ts}-${index}`}
          messageId={`inbox-${item.kind}-${item.ts}-${index}`}
          role={item.kind === "answer" ? "human" : item.kind === "ask-interrupted" ? "interrupt" : "agent"}
          label={itemLabel(item)}
          timestamp={formatTime(item.ts)}
          tone={item.kind === "answer" ? "tinted" : item.kind === "ask" ? "outline" : item.kind === "ask-interrupted" ? "destructive" : "ghost"}
          receipt={result ? <DeliveryReceipt result={result} /> : deliveryLabel(item)}
        >
          <div className="whitespace-pre-wrap">{itemBody(item)}</div>
        </ConversationMessage>
      ))}
    </>
  )
}

function CodexWriteDisclosure({ onAcknowledge }: { onAcknowledge: () => void }) {
  return (
    <Alert className="mb-2 border-need/30 bg-need-soft">
      <AlertTitle>Task transcript delivery</AlertTitle>
      <AlertDescription className="text-[12px] leading-5 text-ink-2">Questions and replies are appended to the original task transcript. Humanctl refuses while that task is actively running.</AlertDescription>
      <AlertAction><Button size="sm" variant="ghost" onClick={onAcknowledge}>Enable</Button></AlertAction>
    </Alert>
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
      <MessageScrollerItem messageId="timeline-loading" className="flex flex-col gap-px border-b border-border px-4 py-3" role="status" aria-label="Loading conversation">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </MessageScrollerItem>
    )
  }

  if (resource.error && !timeline) {
    return (
      <MessageScrollerItem messageId="timeline-error" className="border-b border-border px-4 py-5 text-[13px] text-block">
        <p>{resource.error}</p>
        <Button size="sm" className="mt-3" onClick={() => { void dispatch({ type: "timeline.open", session }) }}>
          <RefreshCwIcon data-icon="inline-start" /> Retry
        </Button>
      </MessageScrollerItem>
    )
  }

  if (!timeline || timeline.items.length === 0) {
    return <MessageScrollerItem messageId="timeline-empty" className="border-b border-border px-4 py-5 text-[13px] text-ink-3">No conversation events were found.</MessageScrollerItem>
  }

  return (
    <>
      {!timeline.atStart ? (
        <MessageScrollerItem messageId="timeline-load-older" className="flex h-10 items-center justify-center border-b border-border">
          <Button
            size="sm"
            variant="ghost"
            disabled={timeline.loadingOlder}
            onClick={onLoadOlder}
          >
            {timeline.loadingOlder ? <Spinner data-icon="inline-start" /> : <HistoryIcon data-icon="inline-start" />}
            {timeline.estEarlier ? `Load about ${timeline.estEarlier} earlier` : "Load older"}
          </Button>
        </MessageScrollerItem>
      ) : null}
      {timeline.items.map((item) => item.event.k === "tools" ? (
        <ConversationMarker key={item.key} messageId={`timeline-${item.key}`} timestamp={formatTime(item.event.ts)}>
          {item.event.n} tool call{item.event.n === 1 ? "" : "s"}
        </ConversationMarker>
      ) : (
        <ConversationMessage
          key={item.key}
          messageId={`timeline-${item.key}`}
          role={item.event.k === "user" ? "human" : item.event.k === "interrupt" ? "interrupt" : "agent"}
          label={item.event.k === "user" ? "You" : item.event.k === "interrupt" ? "Interrupted" : "Agent"}
          timestamp={formatTime(item.event.ts)}
        >
          <p className="whitespace-pre-wrap">{item.event.t || "No text recorded"}</p>
        </ConversationMessage>
      ))}
      <ConversationMarker messageId="timeline-status" icon={null} tone={resource.error ? "block" : timeline.live ? "work" : "default"}>
        {[timeline.live ? "Live" : "Snapshot", resource.error ? "Updates degraded" : null, timeline.capped ? "Newest 600 events shown" : null].filter(Boolean).join(" · ")}
      </ConversationMarker>
    </>
  )
}

export function SessionDetail({ model, dispatch, session, thread, onClose }: SessionDetailProps) {
  const [draft, setDraft] = useState("")
  const [answer, setAnswer] = useState<string | null>(null)
  const [localAnswers, setLocalAnswers] = useState<LocalAnswer[]>([])
  const [answerFailure, setAnswerFailure] = useState<string | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [askFailure, setAskFailure] = useState<string | null>(null)
  const [summaryFailure, setSummaryFailure] = useState<string | null>(null)
  const appState = model.resources.appState.data
  const pinned = session ? appState.pins.includes(session.id) : false
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

  async function loadOlder() {
    await dispatch({ type: "timeline.loadOlder" })
  }

  if (!session) {
    return (
      <div className="h-full border-l border-border">
        <EmptyState title="Select a task" description="Choose a row to inspect its updates, transcript, context, and available actions." />
      </div>
    )
  }

  const activeSession = session

  const asking = operationPending(model.operations, `session.ask:${activeSession.id}`)
  const answering = operationPending(model.operations, `ask.answer:${activeSession.id}`)
  const summarizing = operationPending(model.operations, `session.summarize:${activeSession.id}`)
  const resuming = operationPending(model.operations, `session.resume:${activeSession.id}`)
  const askError = askFailure || model.operations[`session.ask:${activeSession.id}`]?.error
  const threadEntries = combineThreadEntries(thread?.items || [], localAnswers)
  const pendingAsk = pendingAskFrom(threadEntries)
  const replyAllowed = activeSession.state === "need" || activeSession.state === "block"
  const replyError = answerFailure || model.operations[`ask.answer:${activeSession.id}`]?.error
  const composerPending = pendingAsk ? answering : asking
  const composerError = pendingAsk ? replyError : askError
  const summaryError = summaryFailure || model.operations[`session.summarize:${activeSession.id}`]?.error
  const resumeError = model.operations[`session.resume:${activeSession.id}`]?.error
  const codexAcknowledged = activeSession.harness !== "codex" || appState.askCodexAck === true

  function acknowledgeCodexWrites() {
    void dispatch({ type: "app.patch", patch: { askCodexAck: true } })
  }

  async function submitDraft() {
    const value = draft.trim()
    if (!value || composerPending) return

    if (pendingAsk) {
      setAnswerFailure(null)
      const outcome = await dispatch({ type: "ask.answer", session: activeSession, text: value })
      if (!outcome.ok) {
        setAnswerFailure(outcome.error)
        return
      }
      const result = outcome.value as HumanctlAnswerResult
      if (!result || result.ok === false) {
        setAnswerFailure(result?.error || result?.deliverError || (result?.needsAck ? "Acknowledge task transcript writes before replying." : "The reply was not delivered."))
        return
      }
      setLocalAnswers((current) => [...current, { item: {
        kind: "answer",
        text: value,
        delivery: result.delivery,
        actor: "human",
        ts: new Date(result.at || Date.now()).toISOString(),
      }, result }])
      setDraft("")
      return
    }

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
    setDraft("")
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
      data-session-id={session.id}
      scrollMode="messages"
      bodyLabel={`${sessionTitle(session)} conversation`}
      title={sessionTitle(session)}
      eyebrow={<span className="flex items-center gap-2"><HarnessMark harness={session.harness} />{sessionRepo(session)}</span>}
      meta={[session.model, session.reasoningEffort, session.age].filter(Boolean).join(" · ")}
      onClose={onClose}
      actions={
        <>
          <Menu>
            <MenuTrigger render={<IconButton aria-label="Task actions" size="sm" variant="ghost" />}>
              <MoreHorizontalIcon />
            </MenuTrigger>
            <MenuContent align="end">
              <MenuGroup>
                <MenuItem onClick={() => { void dispatch({ type: "session.togglePin", id: session.id }) }}>
                  <PinIcon className={pinned ? "fill-current text-primary" : undefined} />
                  {pinned ? "Unpin task" : "Pin task"}
                </MenuItem>
                {session.path ? (
                  <MenuItem onClick={() => { void dispatch({ type: "session.reveal", path: session.path! }) }}>
                    <FolderOpenIcon /> Reveal transcript
                  </MenuItem>
                ) : null}
              </MenuGroup>
            </MenuContent>
          </Menu>
          <Button size="sm" variant="primary" disabled={resuming} onClick={() => { void dispatch({ type: "session.resume", session }) }}>
            {resuming ? <Spinner data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
            Resume
          </Button>
        </>
      }
      footer={
        <div className="flex flex-col gap-2">
          {!codexAcknowledged ? <CodexWriteDisclosure onAcknowledge={acknowledgeCodexWrites} /> : null}
          {pendingAsk ? (
            <Alert className="border-need/30 bg-need-soft">
              <AlertTitle>Waiting for your answer</AlertTitle>
              <AlertDescription className="max-h-28 overflow-y-auto whitespace-pre-wrap text-[12px] leading-5 text-ink-2">
                {pendingAsk.reason}
              </AlertDescription>
            </Alert>
          ) : null}
          <Composer
            value={draft}
            onValueChange={setDraft}
            onSubmit={() => { void submitDraft() }}
            placeholder={pendingAsk ? "Answer this question" : "Ask this session"}
            submitLabel={pendingAsk ? "Answer" : "Ask"}
            submitting={composerPending}
            disabled={composerPending || !codexAcknowledged || Boolean(pendingAsk && !replyAllowed)}
            hint={pendingAsk && !replyAllowed ? `Reply unavailable while ${stateLabel(session.state).toLowerCase()}` : undefined}
          />
          {composerError ? <p className="text-[12px] leading-5 text-block">{composerError}</p> : null}
        </div>
      }
    >
      <MessageScrollerItem messageId="task-status" className="flex min-h-11 items-center gap-3 border-b border-border px-4">
          <SessionStatus state={session.state} />
          <span className="truncate text-[12px] text-ink-3">{session.stateReason || "No status reason recorded"}</span>
          {session.contextPct != null ? <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">{Math.round(session.contextPct)}% context</span> : null}
      </MessageScrollerItem>
      {resumeError ? <MessageScrollerItem messageId="resume-error" className="border-b border-border bg-block-soft px-4 py-2 text-[12px] leading-5 text-block">Resume failed: {resumeError}</MessageScrollerItem> : null}

      <MessageScrollerItem messageId="section-summary">
        <SectionHeading trailing={
          <Button size="sm" variant="ghost" disabled={summarizing} onClick={() => { void summarize() }}>
            {summarizing ? <Spinner data-icon="inline-start" /> : <SparklesIcon data-icon="inline-start" />}
            Summarize
          </Button>
        }>
          Summary
        </SectionHeading>
      </MessageScrollerItem>
      <MessageScrollerItem messageId="summary" className="border-b border-border px-4 py-3 text-[13px] leading-5 text-ink-2">
        <div className="max-w-[var(--measure-prose)]">
          {summary || session.summary?.text || session.prevAgent || "No summary has been generated for this task."}
          {session.summary?.engine && !summary ? <div className="mt-1 font-mono text-[11px] text-ink-3">Generated by {session.summary.engine}</div> : null}
          {summaryError ? <div className="mt-2 text-[12px] text-block">Summary failed: {summaryError}</div> : null}
        </div>
      </MessageScrollerItem>

      <MessageScrollerItem messageId="section-facts">
        <SectionHeading>Task facts</SectionHeading>
      </MessageScrollerItem>
      <MessageScrollerItem messageId="task-facts" className="divide-y divide-border border-b border-border text-[12px]">
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-2"><span className="text-ink-3">Task ID</span><code className="truncate font-mono text-[11px] text-ink-2">{session.id}</code></div>
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 px-4 py-2"><span className="text-ink-3">Workspace</span><span className="truncate text-ink-2">{session.cwd || session.repo || "Unknown"}</span></div>
          {session.path ? <div className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 px-4 py-2"><span className="text-ink-3">Transcript</span><Button size="sm" variant="ghost" className="min-w-0 justify-start px-0 text-primary" onClick={() => { void dispatch({ type: "session.reveal", path: session.path! }) }}><span className="truncate">{session.path}</span><ExternalLinkIcon data-icon="inline-end" /></Button></div> : null}
      </MessageScrollerItem>

      <MessageScrollerItem messageId="section-inbox">
        <SectionHeading>Inbox thread</SectionHeading>
      </MessageScrollerItem>
      <ThreadStream entries={threadEntries} />

      <MessageScrollerItem messageId="section-conversation">
        <SectionHeading>Conversation</SectionHeading>
      </MessageScrollerItem>
      <Timeline model={model} dispatch={dispatch} session={session} onLoadOlder={() => { void loadOlder() }} />
      {answer ? (
        <ConversationMessage messageId="session-answer-local" role="agent" label="Session answer">
          <p className="whitespace-pre-wrap">{answer}</p>
        </ConversationMessage>
      ) : null}
    </DetailPane>
  )
}
