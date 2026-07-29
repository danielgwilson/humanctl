import { lazy, Suspense } from "react"

import { Skeleton } from "@humanctl/ui/components/skeleton"

import type { HumanctlApplicationModel, HumanctlDispatch, HumanctlInboxThread, HumanctlSession } from "./contracts"

const SessionDetail = lazy(async () => ({ default: (await import("./session-detail")).SessionDetail }))

type LazySessionDetailProps = {
  model: HumanctlApplicationModel
  dispatch: HumanctlDispatch
  session: HumanctlSession | null
  thread?: HumanctlInboxThread | null
  onClose?: () => void
}

function SessionDetailFallback() {
  return (
    <div className="flex h-full min-h-0 flex-col border-l border-border" role="status" aria-label="Loading task detail">
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4">
        <Skeleton className="h-6 w-6" />
        <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3 w-40" /><Skeleton className="h-3 w-24" /></div>
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-px p-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="shrink-0 border-t border-border p-3"><Skeleton className="h-24 w-full" /></div>
    </div>
  )
}

function LazySessionDetail(props: LazySessionDetailProps) {
  return <Suspense fallback={<SessionDetailFallback />}><SessionDetail {...props} /></Suspense>
}

export { LazySessionDetail, SessionDetailFallback }
