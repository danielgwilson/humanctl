import type { ReactNode } from 'react';
import { LayoutGrid } from 'lucide-react';
import { Item, ItemGroup, ItemSeparator } from '@/components/ui/item';
import { ViewHeader } from '@/components/shell/view-header';
import { useSkillAggregate } from '@/hooks/use-humanctl';
import { fmtCadence, fmtResetClock, fmtTok, fmtUSD } from '@/lib/format';
import type { SessionRow, Status } from '@/lib/types';

// Metrics is the SOLE detailed home for spend/tokens/quota (DESIGN.md
// one-owner table: "Spend, tokens, quota | Metrics view | bottom bar shows
// Codex + Claude quota always [...]; Claude quota renders 'n/a' honestly").
// The harness breakdown below is fused with dollars ($ + session count per
// harness in one row) rather than a bare count -- a bare per-harness/per-state
// session COUNT breakdown is Fleet's signal (Fleet owns "fleet shape"), so it
// is intentionally not duplicated here.

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="px-6 pb-1 pt-5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-ink4">{children}</div>;
}

function StatRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Item size="sm" className="justify-between px-6">
      <span className="text-[12.5px] text-ink3">{label}</span>
      <span className="flex items-baseline gap-1.5 font-mono text-[13px] font-semibold text-foreground">
        {value}
        {hint && <span className="font-sans text-[10.5px] font-normal text-ink4">{hint}</span>}
      </span>
    </Item>
  );
}

export function MetricsView({ rows, status }: { rows: SessionRow[]; status: Status | null }) {
  const { agg } = useSkillAggregate(true);

  const claudeRows = rows.filter((r) => r.harness === 'claude-code');
  const codexRows = rows.filter((r) => r.harness === 'codex');
  const claudeUSD = claudeRows.length ? claudeRows.reduce((s, r) => s + (r.costUSD || 0), 0) : null;
  const codexUSD = codexRows.length ? codexRows.reduce((s, r) => s + (r.apiEquivUSD || 0), 0) : null;

  const tokens = status ? (status.per['claude-code']?.totalTokens || 0) + (status.per.codex?.totalTokens || 0) : null;

  const ctxRows = rows.filter((r) => r.contextPct != null) as (SessionRow & { contextPct: number })[];
  const avgCtx = ctxRows.length ? Math.round(ctxRows.reduce((s, r) => s + r.contextPct, 0) / ctxRows.length) : null;

  const qp = status?.codexQuota?.primary;
  const qs = status?.codexQuota?.secondary;

  const topSkills = agg ? Object.entries(agg.skills).sort((a, b) => b[1] - a[1]).slice(0, 6) : [];
  const maxSkillCount = topSkills.length ? topSkills[0][1] : 1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ViewHeader icon={LayoutGrid} title="Metrics" subtitle="spend, tokens, and quota" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-8">
        <SectionLabel>Spend</SectionLabel>
        <ItemGroup>
          <StatRow
            label="claude spend (est)"
            value={claudeUSD != null ? (fmtUSD(claudeUSD) as string) : 'n/a'}
            hint={claudeRows.length ? `${claudeRows.length} ${claudeRows.length === 1 ? 'session' : 'sessions'}` : undefined}
          />
          <ItemSeparator />
          <StatRow
            label="codex api-equiv (est)"
            value={codexUSD != null ? (fmtUSD(codexUSD) as string) : 'n/a'}
            hint={codexRows.length ? `${codexRows.length} ${codexRows.length === 1 ? 'session' : 'sessions'}` : undefined}
          />
          <ItemSeparator />
          <StatRow label="tokens (fleet)" value={tokens != null ? fmtTok(tokens) : 'n/a'} />
        </ItemGroup>

        <SectionLabel>Quota</SectionLabel>
        <ItemGroup>
          {qp?.used_percent != null ? (
            <>
              <StatRow
                label={`codex quota (${fmtCadence(qp.window_minutes) || '5h'})`}
                value={`${Math.round(qp.used_percent)}%`}
                hint={qp.resets_at ? `resets ${fmtResetClock(qp.resets_at)}` : undefined}
              />
              <ItemSeparator />
            </>
          ) : null}
          {qs?.used_percent != null ? (
            <>
              <StatRow
                label={`codex quota (${fmtCadence(qs.window_minutes) || 'weekly'})`}
                value={`${Math.round(qs.used_percent)}%`}
                hint={qs.resets_at ? `resets ${fmtResetClock(qs.resets_at)}` : undefined}
              />
              <ItemSeparator />
            </>
          ) : null}
          <StatRow label="claude quota" value="n/a" hint="transcripts expose no rate-limit data" />
        </ItemGroup>

        <SectionLabel>Context</SectionLabel>
        <ItemGroup>
          <StatRow label="avg context fill" value={avgCtx != null ? `${avgCtx}%` : 'n/a'} />
          <ItemSeparator />
          <StatRow label="near compaction (>80%)" value={status ? String(status.nearCompaction) : 'n/a'} />
        </ItemGroup>

        {topSkills.length > 0 && (
          <>
            <SectionLabel>Top skills{agg ? ` · ${agg.sessionsWithSkills} sessions used one` : ''}</SectionLabel>
            <div className="flex flex-col gap-1.5 px-6 py-1">
              {topSkills.map(([name, count]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-32 flex-none truncate font-mono text-[10.5px] text-ink3" title={name}>{name}</span>
                  <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-panel2">
                    <div className="h-full rounded-full bg-iris" style={{ width: `${Math.max(6, Math.round((count / maxSkillCount) * 100))}%` }} />
                  </div>
                  <span className="w-6 flex-none text-right font-mono text-[10.5px] text-ink3">{count}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
