/**
 * Synthetic sample vault for the Brain view.
 *
 * Every person, organization, quote, and file name below is fabricated for the
 * public browser build and screenshots. This module never reads a real vault.
 * When the desktop vault reader lands it will supply this shape from disk, and
 * the fixture stays as the browser-mode and screenshot source.
 */

export type BrainTier = "inner" | "active" | "peripheral" | "dormant"
export type BrainLifecycle = "new" | "building" | "steady" | "cooling" | "reconnect"

export interface BrainThread {
  heading: string
  body: string
}

export interface BrainBacklink {
  date: string
  source: string
  quote: string
}

export interface BrainRelationship {
  name: string
  kind: string
}

export interface BrainPerson {
  id: string
  name: string
  role: string
  tier: BrainTier
  lifecycle: BrainLifecycle
  priority: number
  lastContactDays: number
  cadenceDays: number
  reach: string[]
  summary: string
  nextTouch: string
  threads: BrainThread[]
  relationships: BrainRelationship[]
  backlinks: BrainBacklink[]
}

export type BrainProposalKind = "merge" | "new-entity" | "field-update" | "tier-change"

export interface BrainProposal {
  id: string
  kind: BrainProposalKind
  title: string
  rationale: string
  confidence: number
  evidence: string[]
}

export interface BrainVitals {
  entities: number
  canonPages: number
  lastIngest: string
  ingestOk: boolean
}

export interface BrainVault {
  people: ReadonlyArray<BrainPerson>
  proposals: ReadonlyArray<BrainProposal>
  vitals: BrainVitals
}

export function cadenceState(person: BrainPerson): "ok" | "due" | "overdue" {
  if (person.cadenceDays <= 0) return "ok"
  const ratio = person.lastContactDays / person.cadenceDays
  if (ratio > 1) return "overdue"
  if (ratio >= 0.8) return "due"
  return "ok"
}

const people: BrainPerson[] = [
  {
    id: "p-mara-voss",
    name: "Mara Voss",
    role: "Founder, climate sensor hardware",
    tier: "inner",
    lifecycle: "steady",
    priority: 92,
    lastContactDays: 6,
    cadenceDays: 14,
    reach: ["email", "signal"],
    summary: "Intro'd her to two infra founders after the offsite. She owes a reply on the pilot scope, and I owe her a reference architecture sketch.",
    nextTouch: "Send the reference architecture sketch she asked for",
    threads: [
      { heading: "How we met", body: "Seated next to each other at a founders dinner. Talked the whole night about why hardware pilots stall on integration, not on the sensor." },
      { heading: "Open threads", body: "Pilot scope for the sensor rollout is blocked on a reference architecture. She wants design partners with real deployments, not logos for a slide." },
      { heading: "Signals", body: "Raising a bridge round next quarter. Prefers warm technical intros over investor blasts." },
    ],
    relationships: [
      { name: "Desmond Ilori", kind: "co-investor" },
      { name: "Kaito Nishimura", kind: "advisor" },
    ],
    backlinks: [
      { date: "2026-07-18", source: "offsite-dinner.md", quote: "Mara wants design partners, not logos." },
      { date: "2026-06-30", source: "call-notes.md", quote: "Pilot blocked on a reference architecture." },
    ],
  },
  {
    id: "p-desmond-ilori",
    name: "Desmond Ilori",
    role: "General partner, dev-tools fund",
    tier: "active",
    lifecycle: "building",
    priority: 78,
    lastContactDays: 21,
    cadenceDays: 21,
    reach: ["email"],
    summary: "He asked to see two portfolio-adjacent founders. Sent one. Still owe him the second, plus a note on the observability thesis he floated.",
    nextTouch: "Forward the second founder intro and react to his observability thesis",
    threads: [
      { heading: "Open threads", body: "Wants a read on where developer observability is over-funded. Offered to co-host a small dinner in the fall." },
      { heading: "Signals", body: "Writing first checks again after a quiet year. Fast on decisions when the founder is technical." },
    ],
    relationships: [{ name: "Mara Voss", kind: "co-investor" }],
    backlinks: [
      { date: "2026-07-09", source: "fund-sync.md", quote: "Desmond is writing first checks again." },
    ],
  },
  {
    id: "p-lena-okonkwo",
    name: "Lena Okonkwo",
    role: "Design lead, payments",
    tier: "active",
    lifecycle: "cooling",
    priority: 71,
    lastContactDays: 34,
    cadenceDays: 21,
    reach: ["email", "signal"],
    summary: "We drifted after her team reorg. She was excited about a design-systems collaboration. Worth a low-pressure reconnect before it goes cold.",
    nextTouch: "Reconnect with a short note about the design-systems idea",
    threads: [
      { heading: "Open threads", body: "Floated collaborating on a shared component language across two teams. Went quiet during her reorg." },
    ],
    relationships: [],
    backlinks: [
      { date: "2026-06-24", source: "coffee-notes.md", quote: "Lena wants to compare component languages." },
    ],
  },
  {
    id: "p-nikhil-barot",
    name: "Nikhil Barot",
    role: "Angel investor, ex-operator",
    tier: "inner",
    lifecycle: "steady",
    priority: 84,
    lastContactDays: 41,
    cadenceDays: 21,
    reach: ["email"],
    summary: "Overdue. He always replies fast but I let this slip. Owe him a quarterly update and a thank-you for the last intro, which closed.",
    nextTouch: "Send the quarterly update and thank him for the intro that closed",
    threads: [
      { heading: "Signals", body: "Values consistent short updates over long ones. The last intro he made converted into a real partnership." },
    ],
    relationships: [{ name: "Aria Sandoval", kind: "former colleague" }],
    backlinks: [
      { date: "2026-05-30", source: "intro-thread.md", quote: "Nikhil's intro closed the partnership." },
    ],
  },
  {
    id: "p-aria-sandoval",
    name: "Aria Sandoval",
    role: "Recruiter, former colleague",
    tier: "active",
    lifecycle: "steady",
    priority: 55,
    lastContactDays: 9,
    cadenceDays: 30,
    reach: ["email", "signal"],
    summary: "Sent two candidates last month. She placed one. Keep the loop warm.",
    nextTouch: "Ask how the placed candidate is settling in",
    threads: [],
    relationships: [{ name: "Nikhil Barot", kind: "former colleague" }],
    backlinks: [
      { date: "2026-07-20", source: "hiring-loop.md", quote: "Aria placed the second candidate." },
    ],
  },
  {
    id: "p-kaito-nishimura",
    name: "Kaito Nishimura",
    role: "Research collaborator, ML systems",
    tier: "active",
    lifecycle: "building",
    priority: 69,
    lastContactDays: 5,
    cadenceDays: 14,
    reach: ["email"],
    summary: "Three exchanges in three weeks about an eval harness. Momentum is real. Should propose a concrete next milestone.",
    nextTouch: "Propose a concrete milestone for the shared eval harness",
    threads: [
      { heading: "Open threads", body: "Building a shared eval harness. He owns the data side, we own the runner. Cadence has picked up sharply." },
    ],
    relationships: [{ name: "Mara Voss", kind: "advisor" }],
    backlinks: [
      { date: "2026-07-25", source: "eval-harness.md", quote: "Kaito owns the data side of the harness." },
    ],
  },
  {
    id: "p-wren-halloway",
    name: "Wren Halloway",
    role: "Former manager, now VP eng",
    tier: "active",
    lifecycle: "steady",
    priority: 62,
    lastContactDays: 27,
    cadenceDays: 30,
    reach: ["email"],
    summary: "Reliable mentor relationship. Due for the usual monthly check-in.",
    nextTouch: "Book the monthly check-in",
    threads: [],
    relationships: [],
    backlinks: [
      { date: "2026-07-04", source: "mentor-notes.md", quote: "Wren offered to review the org design draft." },
    ],
  },
  {
    id: "p-sasha-merrick",
    name: "Sasha Merrick",
    role: "Founder friend, consumer",
    tier: "peripheral",
    lifecycle: "steady",
    priority: 33,
    lastContactDays: 12,
    cadenceDays: 60,
    reach: ["signal"],
    summary: "Low-maintenance friendship. Recently launched. Send a genuine congratulations.",
    nextTouch: "Congratulate on the launch",
    threads: [],
    relationships: [],
    backlinks: [],
  },
  {
    id: "p-tomas-reyes",
    name: "Tomas Reyes",
    role: "Engineering manager, infrastructure",
    tier: "peripheral",
    lifecycle: "cooling",
    priority: 40,
    lastContactDays: 58,
    cadenceDays: 45,
    reach: ["email"],
    summary: "Met at a conference. Good rapport, no active thread. A light reconnect would keep the door open.",
    nextTouch: "Share the infra post he would find useful",
    threads: [],
    relationships: [],
    backlinks: [],
  },
  {
    id: "p-idris-fontaine",
    name: "Idris Fontaine",
    role: "Podcast host, technology",
    tier: "dormant",
    lifecycle: "reconnect",
    priority: 22,
    lastContactDays: 124,
    cadenceDays: 90,
    reach: ["email"],
    summary: "Dormant. Invited me on the show a while back. Not a priority, but a friendly note would be easy and kind.",
    nextTouch: "Reply to the standing podcast invite",
    threads: [],
    relationships: [],
    backlinks: [
      { date: "2026-03-28", source: "inbound.md", quote: "Idris left a standing invite to the show." },
    ],
  },
]

const proposals: BrainProposal[] = [
  {
    id: "prop-merge-ilori",
    kind: "merge",
    title: "Merge “D. Ilori” into “Desmond Ilori”",
    rationale: "Two entities share an email domain and three overlapping mentions. Almost certainly the same person recorded twice.",
    confidence: 0.86,
    evidence: ["fund-sync.md", "intro-thread.md"],
  },
  {
    id: "prop-new-kestrel",
    kind: "new-entity",
    title: "Create organization: Kestrel Labs",
    rationale: "Named across four notes as Mara Voss's company but has no entity page yet. Promoting it would connect her threads to a place.",
    confidence: 0.74,
    evidence: ["offsite-dinner.md", "call-notes.md", "eval-harness.md"],
  },
  {
    id: "prop-cadence-barot",
    kind: "field-update",
    title: "Change Nikhil Barot cadence from 21 to 30 days",
    rationale: "Actual contact pattern over six months averages closer to monthly. The tighter cadence keeps flagging him as overdue.",
    confidence: 0.61,
    evidence: ["intro-thread.md"],
  },
  {
    id: "prop-tier-kaito",
    kind: "tier-change",
    title: "Promote Kaito Nishimura from peripheral to active",
    rationale: "Three substantive exchanges in three weeks on a shared project. Contact frequency now matches an active relationship.",
    confidence: 0.69,
    evidence: ["eval-harness.md"],
  },
]

export const BRAIN_SAMPLE: BrainVault = {
  people,
  proposals,
  vitals: {
    entities: 82,
    canonPages: 61,
    lastIngest: "2h",
    ingestOk: true,
  },
}
