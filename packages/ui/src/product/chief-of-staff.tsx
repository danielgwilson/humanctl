import { useState } from "react"

import { Composer } from "@humanctl/ui/blocks/composer"
import { ConversationMarker, ConversationMessage } from "@humanctl/ui/blocks/conversation"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@humanctl/ui/components/message-scroller"
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@humanctl/ui/components/sheet"
import { Spinner } from "@humanctl/ui/components/spinner"

import type { HumanctlApplicationProps } from "./contracts"
import { formatTime, operationPending } from "./helpers"

function ChiefOfStaff({ model, dispatch }: Pick<HumanctlApplicationProps, "model" | "dispatch">) {
  const appState = model.resources.appState.data
  const history = model.resources.atlas.data
  const [question, setQuestion] = useState("")
  const [askFailure, setAskFailure] = useState<string | null>(null)
  const asking = operationPending(model.operations, "atlas.ask")
  const operationError = model.operations["atlas.ask"]?.error

  async function ask() {
    const value = question.trim()
    if (!value || asking) return
    setAskFailure(null)
    const outcome = await dispatch({ type: "atlas.ask", question: value, engine: appState.summarizer })
    if (!outcome.ok) {
      setAskFailure(outcome.error)
      return
    }
    setQuestion("")
  }

  return (
    <Sheet open={appState.rightRailOpen} onOpenChange={(open) => { void dispatch({ type: "app.patch", patch: { rightRailOpen: open } }) }}>
      <SheetContent className="w-[min(26rem,92vw)]" side="right">
        <SheetHeader>
          <SheetTitle>Chief of staff</SheetTitle>
          <SheetDescription>Ask about current fleet state, blockers, and what needs your attention.</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex min-h-0 flex-col gap-0 p-0">
          <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport aria-label="Chief of staff conversation">
                <MessageScrollerContent className="gap-0">
                  {history.length === 0 && !asking ? (
                    <MessageScrollerItem messageId="chief-of-staff-empty" className="border-b border-border px-4 py-6 text-[13px] leading-5 text-ink-3">
                      Try “what needs me right now?” or “which task is most likely to be stale?” Answers are advisory and grounded in the current local fleet snapshot.
                    </MessageScrollerItem>
                  ) : null}
                  {history.flatMap((exchange) => [
                    <ConversationMessage key={`${exchange.id}-question`} messageId={`${exchange.id}-question`} role="human" label="You" tone="tinted">
                      <p className="whitespace-pre-wrap">{exchange.question}</p>
                    </ConversationMessage>,
                    <ConversationMessage key={`${exchange.id}-answer`} messageId={`${exchange.id}-answer`} role="agent" label={exchange.engine || "Local harness"} timestamp={formatTime(exchange.at)}>
                      <p className="whitespace-pre-wrap">{exchange.answer}</p>
                    </ConversationMessage>,
                  ])}
                  {asking ? <ConversationMarker messageId="chief-of-staff-reading" icon={<Spinner />} tone="work">Reading the fleet</ConversationMarker> : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          </MessageScrollerProvider>
          <div className="shrink-0 border-t border-border p-3">
            <Composer value={question} onValueChange={setQuestion} onSubmit={() => { void ask() }} placeholder="Ask your chief of staff" submitLabel="Ask" submitting={asking} disabled={asking} />
            {askFailure || operationError ? <p className="mt-2 text-[12px] leading-5 text-block">{askFailure || operationError}</p> : null}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

export { ChiefOfStaff }
