import type { ReactNode } from "react"
import { BotIcon, CircleAlertIcon, UserIcon, WrenchIcon } from "lucide-react"

import { Bubble, BubbleContent } from "@humanctl/ui/components/bubble"
import { Marker, MarkerContent, MarkerIcon } from "@humanctl/ui/components/marker"
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
  children,
  className,
}: ConversationMessageProps) {
  const human = role === "human"
  const Icon = human ? UserIcon : role === "interrupt" ? CircleAlertIcon : BotIcon
  const bubbleTone = tone ?? (human ? "tinted" : role === "interrupt" ? "destructive" : "ghost")

  return (
    <MessageScrollerItem
      messageId={messageId}
      scrollAnchor={scrollAnchor}
      className={cn("border-b border-border px-4 py-3", className)}
    >
      <Message align={human ? "end" : "start"}>
        <MessageAvatar aria-hidden="true"><Icon /></MessageAvatar>
        <MessageContent>
          <MessageHeader className="gap-2 font-mono text-[11px] leading-4 text-ink-3">
            <span>{label}</span>
            {timestamp ? <span className="text-ink-4">{timestamp}</span> : null}
          </MessageHeader>
          <Bubble align={human ? "end" : "start"} variant={bubbleTone}>
            <BubbleContent className="text-[13px] leading-5 text-ink-2">{children}</BubbleContent>
          </Bubble>
          {receipt ? <MessageFooter className="font-mono text-[11px] leading-4 text-ink-3">{receipt}</MessageFooter> : null}
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
  return (
    <MessageScrollerItem messageId={messageId} className={cn("border-b border-border px-4 py-2.5", className)}>
      <Marker
        className={cn(
          "font-mono text-[11px] leading-4",
          tone === "work" ? "text-work" : tone === "need" ? "text-need" : tone === "block" ? "text-block" : "text-ink-3",
        )}
      >
        {icon ? <MarkerIcon>{icon}</MarkerIcon> : null}
        <MarkerContent className="flex-1 uppercase tracking-[0.06em]">{children}</MarkerContent>
        {timestamp ? <span className="text-ink-4">{timestamp}</span> : null}
      </Marker>
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
