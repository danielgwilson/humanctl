import type { ReactNode } from "react"
import { BotIcon, CircleAlertIcon, WrenchIcon } from "lucide-react"

import "@humanctl/ui/styles/typeset.css"

import { Bubble, BubbleContent } from "@humanctl/ui/components/bubble"
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@humanctl/ui/components/message"
import { MessageScrollerItem } from "@humanctl/ui/components/message-scroller"
import { cn } from "@humanctl/ui/lib/cn"

type ConversationRole = "agent" | "human" | "interrupt"
type ConversationTone = "default" | "secondary" | "muted" | "tinted" | "outline" | "ghost" | "destructive"

type ConversationMessageProps = {
  messageId: string
  role: ConversationRole
  label: ReactNode
  timestamp?: ReactNode
  receipt?: ReactNode
  tone?: ConversationTone
  scrollAnchor?: boolean
  // Same speaker as the previous turn: fold into the run. A grouped turn drops
  // the repeated avatar and label and tightens to a 2px gap, so a run of agent
  // turns reads as one block instead of N identical bot icons stacked down the
  // margin. A role change opens a 16px gap and reprints the avatar + label.
  continues?: boolean
  children: ReactNode
  className?: string
}

function ConversationMessage({
  messageId,
  role,
  label,
  timestamp,
  receipt,
  tone,
  scrollAnchor = role === "human",
  continues = false,
  children,
  className,
}: ConversationMessageProps) {
  const human = role === "human"
  const Icon = role === "interrupt" ? CircleAlertIcon : BotIcon
  // Canonical chat idiom (ChatGPT/Claude): the agent reads as bare left-aligned
  // prose, the human's own turn carries the soft accent on the right. No filled
  // bubble on the agent, no full-width rules between turns.
  const bubbleTone = tone ?? (human ? "tinted" : role === "interrupt" ? "destructive" : "ghost")

  return (
    <MessageScrollerItem
      messageId={messageId}
      scrollAnchor={scrollAnchor}
      className={cn(continues ? "px-4 pt-0.5 pb-0.5" : "px-4 pt-4 pb-0.5", className)}
    >
      <Message align={human ? "end" : "start"}>
        {human ? null : continues ? (
          // Reserve the avatar column so grouped prose stays left-aligned with
          // the first turn of the run.
          <div className="size-6 min-w-6 shrink-0" aria-hidden="true" />
        ) : (
          <MessageAvatar aria-hidden="true">
            <Icon />
          </MessageAvatar>
        )}
        <MessageContent>
          {continues ? null : (
            <MessageHeader className="gap-2 text-xs leading-4 text-ink-3">
              <span>{label}</span>
              {timestamp ? <span className="text-ink-4">{timestamp}</span> : null}
            </MessageHeader>
          )}
          <Bubble align={human ? "end" : "start"} variant={bubbleTone}>
            <BubbleContent className="typeset typeset-chat text-ink-2">{children}</BubbleContent>
          </Bubble>
          {receipt ? <MessageFooter className="text-xs leading-4 text-ink-3">{receipt}</MessageFooter> : null}
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
}

type ConversationMarkerProps = {
  messageId: string
  timestamp?: ReactNode
  icon?: ReactNode
  tone?: "default" | "work" | "need" | "block"
  children: ReactNode
  className?: string
}

function ConversationMarker({
  messageId,
  timestamp,
  icon = <WrenchIcon />,
  tone = "default",
  children,
  className,
}: ConversationMarkerProps) {
  const toneClass =
    tone === "work" ? "text-work" : tone === "need" ? "text-need" : tone === "block" ? "text-block" : "text-ink-3"
  // An inline event pill anchored to the agent side, not a full-width ruled
  // band. Tool events read as a quiet aside in the transcript, the way modern
  // AI chat surfaces collapse tool calls.
  return (
    <MessageScrollerItem messageId={messageId} className={cn("px-4 py-1.5", className)}>
      <span
        className={cn(
          "inline-flex w-fit items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs leading-4 font-medium [&_svg]:size-3.5",
          toneClass,
        )}
      >
        {icon}
        <span>{children}</span>
        {timestamp ? <span className="text-ink-4">· {timestamp}</span> : null}
      </span>
    </MessageScrollerItem>
  )
}

export {
  ConversationMarker,
  ConversationMessage,
  type ConversationMarkerProps,
  type ConversationMessageProps,
  type ConversationRole,
}
