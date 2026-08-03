import type { VaultSnapshotModel } from './contracts';

/**
 * Public-safe synthetic vault snapshot for the browser build and screenshots.
 *
 * Every person, organization, quote, and file name below is fabricated. It
 * stands in for a real producer so the Brain view is fully reviewable without
 * any real data, and it exercises the exact generic shape a real exporter must
 * emit (labels/annotations/spec/relations, pre-resolved status, queues, and a
 * views hint). Dates are fixed so screenshots are deterministic.
 */
export const FIXTURE_VAULT_SNAPSHOT: VaultSnapshotModel = {
  apiVersion: 'humanctl.dev/vaultsnapshot/v1alpha1',
  generatedAt: '2026-08-02T09:00:00Z',
  source: 'markdown vault',
  vitals: { entities: 82, canonPages: 61, lastIngest: '2h', ingestOk: true },
  views: {
    people: {
      columns: ['group', 'priority', 'lastContactAt', 'status'],
      sort: 'priority:desc',
      labelTones: {
        group: { inner: 'accent', active: 'positive', peripheral: 'muted', dormant: 'faint' },
      },
    },
  },
  entities: [
    {
      kind: 'person',
      id: 'person:mara-voss',
      label: 'Mara Voss',
      labels: { group: 'inner', lifecycle: 'steady' },
      annotations: { role: 'Founder, climate sensor hardware' },
      spec: {
        priority: 92,
        lastContactAt: '2026-07-27',
        cadenceDays: 14,
        status: 'on-track',
        nextTouch: 'Send the reference architecture sketch she asked for',
        summary:
          "Intro'd her to two infra founders after the offsite. She owes a reply on the pilot scope, and I owe her a reference architecture sketch.",
        sections: [
          { heading: 'How we met', body: 'Seated next to each other at a founders dinner. Talked the whole night about why hardware pilots stall on integration, not on the sensor.' },
          { heading: 'Open threads', body: 'Pilot scope for the sensor rollout is blocked on a reference architecture. She wants design partners with real deployments, not logos for a slide.' },
          { heading: 'Signals', body: 'Raising a bridge round next quarter. Prefers warm technical intros over investor blasts.' },
        ],
        evidence: [
          { date: '2026-07-18', source: 'offsite-dinner.md', quote: 'Mara wants design partners, not logos.' },
          { date: '2026-06-30', source: 'call-notes.md', quote: 'Pilot blocked on a reference architecture.' },
        ],
      },
      relations: [
        { type: 'connected', targetRef: 'person:desmond-ilori', note: 'co-investor' },
        { type: 'connected', targetRef: 'person:kaito-nishimura', note: 'advisor' },
      ],
    },
    {
      kind: 'person',
      id: 'person:desmond-ilori',
      label: 'Desmond Ilori',
      labels: { group: 'active', lifecycle: 'building' },
      annotations: { role: 'General partner, dev-tools fund' },
      spec: {
        priority: 78,
        lastContactAt: '2026-07-12',
        cadenceDays: 21,
        status: 'due',
        nextTouch: 'Forward the second founder intro and react to his observability thesis',
        summary: 'He asked to see two portfolio-adjacent founders. Sent one. Still owe him the second, plus a note on the observability thesis he floated.',
        sections: [
          { heading: 'Open threads', body: 'Wants a read on where developer observability is over-funded. Offered to co-host a small dinner in the fall.' },
        ],
        evidence: [{ date: '2026-07-09', source: 'fund-sync.md', quote: 'Desmond is writing first checks again.' }],
      },
      relations: [{ type: 'connected', targetRef: 'person:mara-voss', note: 'co-investor' }],
    },
    {
      kind: 'person',
      id: 'person:lena-okonkwo',
      label: 'Lena Okonkwo',
      labels: { group: 'active', lifecycle: 'cooling' },
      annotations: { role: 'Design lead, payments' },
      spec: {
        priority: 71,
        lastContactAt: '2026-06-29',
        cadenceDays: 21,
        status: 'overdue',
        nextTouch: 'Reconnect with a short note about the design-systems idea',
        summary: 'We drifted after her team reorg. She was excited about a design-systems collaboration. Worth a low-pressure reconnect before it goes cold.',
        sections: [
          { heading: 'Open threads', body: 'Floated collaborating on a shared component language across two teams. Went quiet during her reorg.' },
        ],
        evidence: [{ date: '2026-06-24', source: 'coffee-notes.md', quote: 'Lena wants to compare component languages.' }],
      },
    },
    {
      kind: 'person',
      id: 'person:nikhil-barot',
      label: 'Nikhil Barot',
      labels: { group: 'inner', lifecycle: 'steady' },
      annotations: { role: 'Angel investor, ex-operator' },
      spec: {
        priority: 84,
        lastContactAt: '2026-06-22',
        cadenceDays: 21,
        status: 'overdue',
        nextTouch: 'Send the quarterly update and thank him for the intro that closed',
        summary: 'Overdue. He always replies fast but I let this slip. Owe him a quarterly update and a thank-you for the last intro, which closed.',
        sections: [
          { heading: 'Signals', body: 'Values consistent short updates over long ones. The last intro he made converted into a real partnership.' },
        ],
        evidence: [{ date: '2026-05-30', source: 'intro-thread.md', quote: "Nikhil's intro closed the partnership." }],
      },
      relations: [{ type: 'connected', targetRef: 'person:aria-sandoval', note: 'former colleague' }],
    },
    {
      kind: 'person',
      id: 'person:aria-sandoval',
      label: 'Aria Sandoval',
      labels: { group: 'active', lifecycle: 'steady' },
      annotations: { role: 'Recruiter, former colleague' },
      spec: {
        priority: 55,
        lastContactAt: '2026-07-24',
        cadenceDays: 30,
        status: 'on-track',
        nextTouch: 'Ask how the placed candidate is settling in',
        summary: 'Sent two candidates last month. She placed one. Keep the loop warm.',
        evidence: [{ date: '2026-07-20', source: 'hiring-loop.md', quote: 'Aria placed the second candidate.' }],
      },
      relations: [{ type: 'connected', targetRef: 'person:nikhil-barot', note: 'former colleague' }],
    },
    {
      kind: 'person',
      id: 'person:kaito-nishimura',
      label: 'Kaito Nishimura',
      labels: { group: 'active', lifecycle: 'building' },
      annotations: { role: 'Research collaborator, ML systems' },
      spec: {
        priority: 69,
        lastContactAt: '2026-07-28',
        cadenceDays: 14,
        status: 'on-track',
        nextTouch: 'Propose a concrete milestone for the shared eval harness',
        summary: 'Three exchanges in three weeks about an eval harness. Momentum is real. Should propose a concrete next milestone.',
        sections: [
          { heading: 'Open threads', body: 'Building a shared eval harness. He owns the data side, we own the runner. Cadence has picked up sharply.' },
        ],
        evidence: [{ date: '2026-07-25', source: 'eval-harness.md', quote: 'Kaito owns the data side of the harness.' }],
      },
      relations: [{ type: 'connected', targetRef: 'person:mara-voss', note: 'advisor' }],
    },
    {
      kind: 'person',
      id: 'person:wren-halloway',
      label: 'Wren Halloway',
      labels: { group: 'active', lifecycle: 'steady' },
      annotations: { role: 'Former manager, now VP eng' },
      spec: {
        priority: 62,
        lastContactAt: '2026-07-06',
        cadenceDays: 30,
        status: 'due',
        nextTouch: 'Book the monthly check-in',
        summary: 'Reliable mentor relationship. Due for the usual monthly check-in.',
        evidence: [{ date: '2026-07-04', source: 'mentor-notes.md', quote: 'Wren offered to review the org design draft.' }],
      },
    },
    {
      kind: 'person',
      id: 'person:sasha-merrick',
      label: 'Sasha Merrick',
      labels: { group: 'peripheral', lifecycle: 'steady' },
      annotations: { role: 'Founder friend, consumer' },
      spec: {
        priority: 33,
        lastContactAt: '2026-07-21',
        cadenceDays: 60,
        status: 'on-track',
        nextTouch: 'Congratulate on the launch',
        summary: 'Low-maintenance friendship. Recently launched. Send a genuine congratulations.',
      },
    },
    {
      kind: 'person',
      id: 'person:tomas-reyes',
      label: 'Tomas Reyes',
      labels: { group: 'peripheral', lifecycle: 'cooling' },
      annotations: { role: 'Engineering manager, infrastructure' },
      spec: {
        priority: 40,
        lastContactAt: '2026-06-05',
        cadenceDays: 45,
        status: 'overdue',
        nextTouch: 'Share the infra post he would find useful',
        summary: 'Met at a conference. Good rapport, no active thread. A light reconnect would keep the door open.',
      },
    },
    {
      kind: 'person',
      id: 'person:idris-fontaine',
      label: 'Idris Fontaine',
      labels: { group: 'dormant', lifecycle: 'reconnect' },
      annotations: { role: 'Podcast host, technology' },
      spec: {
        priority: 22,
        lastContactAt: '2026-03-31',
        cadenceDays: 90,
        status: 'overdue',
        nextTouch: 'Reply to the standing podcast invite',
        summary: 'Dormant. Invited me on the show a while back. Not a priority, but a friendly note would be easy and kind.',
        evidence: [{ date: '2026-03-28', source: 'inbound.md', quote: 'Idris left a standing invite to the show.' }],
      },
    },
  ],
  queues: {
    followups: [
      { entityRef: 'person:nikhil-barot', reason: 'Send the quarterly update and thank him for the intro that closed', status: 'overdue', overdueDays: 20 },
      { entityRef: 'person:lena-okonkwo', reason: 'Reconnect with a short note about the design-systems idea', status: 'overdue', overdueDays: 13 },
      { entityRef: 'person:idris-fontaine', reason: 'Reply to the standing podcast invite', status: 'overdue', overdueDays: 34 },
      { entityRef: 'person:tomas-reyes', reason: 'Share the infra post he would find useful', status: 'overdue', overdueDays: 13 },
      { entityRef: 'person:desmond-ilori', reason: 'Forward the second founder intro and react to his observability thesis', status: 'due', overdueDays: 0 },
      { entityRef: 'person:wren-halloway', reason: 'Book the monthly check-in', status: 'due', overdueDays: 0 },
    ],
    proposals: [
      { id: 'prop-merge-ilori', kind: 'merge', title: 'Merge "D. Ilori" into "Desmond Ilori"', rationale: 'Two entities share an email domain and three overlapping mentions. Almost certainly the same person recorded twice.', confidence: 0.86, evidence: ['fund-sync.md', 'intro-thread.md'] },
      { id: 'prop-new-kestrel', kind: 'new-entity', title: 'Create organization: Kestrel Labs', rationale: "Named across four notes as Mara Voss's company but has no entity page yet. Promoting it would connect her threads to a place.", confidence: 0.74, evidence: ['offsite-dinner.md', 'call-notes.md', 'eval-harness.md'] },
      { id: 'prop-cadence-barot', kind: 'field-update', title: 'Change Nikhil Barot cadence from 21 to 30 days', rationale: 'Actual contact pattern over six months averages closer to monthly. The tighter cadence keeps flagging him as overdue.', confidence: 0.61, evidence: ['intro-thread.md'] },
      { id: 'prop-tier-kaito', kind: 'tier-change', title: 'Promote Kaito Nishimura from peripheral to active', rationale: 'Three substantive exchanges in three weeks on a shared project. Contact frequency now matches an active relationship.', confidence: 0.69, evidence: ['eval-harness.md'] },
    ],
  },
};
