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
      annotations: {
        role: 'Founder, climate sensor hardware',
        relationship: 'Close technical collaborator',
        confidence: 'High',
      },
      spec: {
        priority: 92,
        lastContactAt: '2026-07-27',
        cadenceDays: 14,
        status: 'on-track',
        nextTouch: 'Send the reference architecture sketch she asked for',
        summary: 'Close technical collaborator. The pilot is active, the architecture boundary is clear, and the remaining blocker is a concrete deployment plan.',
        sections: [
          {
            heading: 'Current state',
            level: 2,
            body: 'The pilot scope is agreed in principle. The reference architecture and deployment sequence are the two remaining inputs before field work starts.',
            items: ['She owns sensor constraints and pilot acceptance.', 'I own the reference architecture and two design-partner introductions.'],
          },
          {
            heading: 'Open decisions',
            level: 3,
            body: 'Choose one deployment pattern and name the person who can approve an exception during the pilot.',
          },
          {
            heading: 'How we work together',
            level: 2,
            body: 'Lead with the system boundary and a concrete artifact. She prefers direct technical disagreement and short written follow-through.',
            items: ['Use warm technical introductions, not broad blasts.', 'Separate pilot evidence from fundraising narrative.', 'Write down the decision owner before the meeting ends.'],
          },
          {
            heading: 'Why this relationship matters',
            level: 2,
            body: 'She is a strong reality check for hardware-software integration and can connect credible operators who have shipped field deployments.',
          },
          {
            heading: 'Relationship history',
            level: 2,
            body: 'We met at a founders dinner and spent the evening comparing why pilots fail. Two follow-up working sessions turned the conversation into a live design-partner search.',
          },
          {
            heading: 'Evidence boundaries',
            level: 3,
            items: ['The bridge round is planned, not announced.', 'The pilot has not started.', 'No deployment date is committed.'],
          },
        ],
        evidence: [
          { date: '2026-07-18', source: 'offsite-dinner.md', quote: 'Mara wants design partners, not logos.' },
          { date: '2026-06-30', source: 'call-notes.md', quote: 'Pilot blocked on a reference architecture.' },
        ],
      },
      relations: [
        { type: 'connected', targetRef: 'person:desmond-ilori', note: 'co-investor' },
        { type: 'connected', targetRef: 'person:kaito-nishimura', note: 'advisor' },
        { type: 'works-on', targetRef: 'project:aurora-pilot', note: 'design partner' },
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
        summary: 'He asked to see two portfolio-adjacent founders. Sent one. Still owe him the second, plus a note on the observability thesis he floated.',
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
      },
    },
    {
      kind: 'project',
      id: 'project:aurora-pilot',
      label: 'Aurora Pilot',
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
