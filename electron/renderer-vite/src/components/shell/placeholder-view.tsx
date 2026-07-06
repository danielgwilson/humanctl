// Quiet, routable placeholder for the views not yet ported in this stage
// (Sessions/Metrics/Fleet/Settings are stage 2 per docs/ts-migration-plan.md).
// Never a dead link: the nav strip still routes here, it just states the
// honest status instead of silently doing nothing.
export function PlaceholderView({ label, stage }: { label: string; stage: number }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="font-mono text-[44px] font-semibold text-rule2">--</div>
      <div className="text-[16px] font-semibold text-ink2">{label} is coming in stage {stage}</div>
      <div className="max-w-md text-[12.5px] leading-relaxed text-ink3">
        This view is not yet ported to the new renderer. Switch to the default renderer (unset HUMANCTL_VITE) for the complete app.
      </div>
    </div>
  );
}
