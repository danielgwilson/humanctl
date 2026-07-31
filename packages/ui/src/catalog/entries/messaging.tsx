import { BotIcon } from "lucide-react"

import { ConversationMarker, ConversationMessage } from "@humanctl/ui/blocks/conversation"
import { Bubble, BubbleContent } from "@humanctl/ui/components/bubble"
import { Message, MessageAvatar, MessageContent, MessageHeader } from "@humanctl/ui/components/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@humanctl/ui/components/message-scroller"

import type { CatalogEntry } from "../registry"
import { ComposerPreview } from "./previews"

export const messagingEntries: CatalogEntry[] = [
  {
    id: "message",
    name: "Message",
    kind: "component",
    category: "Messaging",
    importPath: "components/message",
    exports: ["Message", "MessageAvatar", "MessageContent", "MessageHeader"],
    blurb: "The row scaffold for one turn in a transcript: avatar, header, and content, aligned by author.",
    tags: ["transcript", "row"],
    states: [
      {
        name: "Agent and human",
        description: "alignment follows the author",
        render: () => (
          <div className="flex w-full max-w-md flex-col gap-4">
            <Message align="start">
              <MessageAvatar aria-hidden="true">
                <BotIcon />
              </MessageAvatar>
              <MessageContent>
                <MessageHeader className="gap-2 text-xs text-ink-3">Agent · 09:41</MessageHeader>
                <Bubble align="start" variant="ghost">
                  <BubbleContent className="typeset typeset-chat text-ink-2">
                    I checked the current branch and found one pending review.
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
            <Message align="end">
              <MessageContent>
                <MessageHeader className="justify-end gap-2 text-xs text-ink-3">You · 09:43</MessageHeader>
                <Bubble align="end" variant="tinted">
                  <BubbleContent className="typeset typeset-chat text-ink-2">
                    Address it, then rerun the browser proof.
                  </BubbleContent>
                </Bubble>
              </MessageContent>
            </Message>
          </div>
        ),
      },
    ],
    accessibility: ["The avatar is decorative; the header carries author and time as readable text."],
    usage: `<Message align="start">
  <MessageAvatar aria-hidden="true"><BotIcon /></MessageAvatar>
  <MessageContent>
    <MessageHeader>Agent · 09:41</MessageHeader>
    <Bubble align="start"><BubbleContent>…</BubbleContent></Bubble>
  </MessageContent>
</Message>`,
  },
  {
    id: "bubble",
    name: "Bubble",
    kind: "component",
    category: "Messaging",
    importPath: "components/bubble",
    exports: ["Bubble", "BubbleContent"],
    blurb: "The message container inside a turn. The soft tinted variant marks the human's own turn on the right; the agent reads as bare prose (ghost) on the left.",
    tags: ["chat", "container"],
    states: [
      {
        name: "Agent and human",
        description: "bare left, soft tint right",
        render: () => (
          <div className="flex w-full max-w-md flex-col gap-3">
            <Bubble align="start" variant="ghost">
              <BubbleContent className="typeset typeset-chat text-ink-2">
                Both theme screenshots pass.
              </BubbleContent>
            </Bubble>
            <Bubble align="end" variant="tinted">
              <BubbleContent className="typeset typeset-chat text-ink-2">
                Ship it once CI is green.
              </BubbleContent>
            </Bubble>
          </div>
        ),
      },
    ],
    props: [
      { name: "align", type: '"start" | "end"', note: "Author side; end (right) is the human's own turn by convention." },
      { name: "variant", type: '"ghost" | "tinted" | "outline" | "default" | ...', note: "ghost = bare agent prose; tinted = soft accent for the human turn. default is a loud filled accent, reserved for rare emphasis." },
    ],
    usage: `<Bubble align="end" variant="tinted">
  <BubbleContent>Ship it once CI is green.</BubbleContent>
</Bubble>`,
  },
  {
    id: "message-scroller",
    name: "MessageScroller",
    kind: "component",
    category: "Messaging",
    importPath: "components/message-scroller",
    exports: ["MessageScroller", "MessageScrollerProvider", "MessageScrollerViewport", "MessageScrollerContent", "MessageScrollerButton"],
    blurb: "The transcript viewport that owns follow-the-tail, prepend preservation, and a return-to-latest control.",
    tags: ["scroll", "transcript"],
    states: [
      {
        name: "Following a transcript",
        description: "pinned to the last anchor",
        render: () => (
          <div className="h-72 w-full max-w-md border border-border">
            <MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
              <MessageScroller>
                <MessageScrollerViewport aria-label="Conversation example">
                  <MessageScrollerContent className="gap-0">
                    <ConversationMessage messageId="cat-a1" role="agent" label="Agent" timestamp="09:41">
                      <p>I checked the current branch and found one pending review.</p>
                    </ConversationMessage>
                    <ConversationMarker messageId="cat-tools" timestamp="09:42">
                      3 tool calls
                    </ConversationMarker>
                    <ConversationMessage messageId="cat-h1" role="human" label="You" timestamp="09:43" tone="tinted">
                      <p>Address it, then rerun the browser proof.</p>
                    </ConversationMessage>
                    <ConversationMessage
                      messageId="cat-a2"
                      role="agent"
                      label="Agent"
                      timestamp="09:45"
                      receipt="Delivered to the task transcript"
                    >
                      <p>The review is resolved. Both theme screenshots pass.</p>
                    </ConversationMessage>
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
        ),
      },
    ],
    accessibility: [
      "New content does not steal focus or reset the reader's scroll position.",
      "The return-to-latest button appears only when the viewport is scrolled away from the tail.",
    ],
    usage: `<MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
  <MessageScroller>
    <MessageScrollerViewport aria-label="Conversation">
      <MessageScrollerContent>{/* messages */}</MessageScrollerContent>
    </MessageScrollerViewport>
    <MessageScrollerButton />
  </MessageScroller>
</MessageScrollerProvider>`,
  },
  {
    id: "conversation",
    name: "Conversation",
    kind: "block",
    category: "Messaging",
    importPath: "blocks/conversation",
    exports: ["ConversationMessage", "ConversationMarker"],
    blurb: "Role-aware transcript turns and compact inline event markers, built on Message and Bubble with chat typeset.",
    tags: ["transcript", "role"],
    states: [
      {
        name: "Turns and a marker",
        description: "agent, human, and a tool-call marker",
        render: () => (
          <div className="w-full max-w-md">
            <MessageScrollerProvider>
              <MessageScroller>
                <MessageScrollerViewport aria-label="Conversation turns">
                  <MessageScrollerContent className="gap-0">
                    <ConversationMessage messageId="cat-b1" role="agent" label="Agent" timestamp="09:41">
                      <p>I found one pending review on the current branch.</p>
                    </ConversationMessage>
                    <ConversationMarker messageId="cat-b-tools" timestamp="09:42">
                      3 tool calls
                    </ConversationMarker>
                    <ConversationMessage messageId="cat-b2" role="human" label="You" timestamp="09:43" tone="tinted">
                      <p>Address it, then rerun the proof.</p>
                    </ConversationMessage>
                  </MessageScrollerContent>
                </MessageScrollerViewport>
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
        ),
      },
    ],
    props: [
      { name: "role", type: '"agent" | "human" | "tool" | "system"', note: "Drives alignment and tone." },
      { name: "tone", type: '"default" | "tinted"', note: "Tinted marks the human turn." },
      { name: "receipt", type: "ReactNode", note: "Optional delivery footer under the turn." },
    ],
    usage: `<ConversationMessage role="agent" label="Agent" timestamp="09:41" messageId="m1">
  <p>I found one pending review.</p>
</ConversationMessage>
<ConversationMarker messageId="m2" timestamp="09:42">3 tool calls</ConversationMarker>`,
  },
  {
    id: "composer",
    name: "Composer",
    kind: "block",
    category: "Messaging",
    importPath: "blocks/composer",
    exports: ["Composer"],
    blurb: "The bounded reply control: a growing textarea, a send action, and a hint, wired for command-Enter to send.",
    tags: ["reply", "input"],
    states: [
      {
        name: "Interactive",
        description: "type and send to see the hint update",
        render: () => <ComposerPreview />,
      },
    ],
    props: [
      { name: "value / onValueChange", type: "string / (v) => void", note: "Controlled draft text." },
      { name: "onSubmit", type: "() => void", note: "Fires on the send action and command-Enter." },
      { name: "hint", type: "ReactNode", note: "Small helper line under the field." },
      { name: "busy", type: "boolean", note: "Shows a spinner and blocks re-submit while a send is in flight." },
    ],
    accessibility: ["Command or Control plus Enter submits; the send action is a real button with a label."],
    usage: `<Composer
  value={value}
  onValueChange={setValue}
  onSubmit={send}
  busy={sending}
/>`,
  },
]
