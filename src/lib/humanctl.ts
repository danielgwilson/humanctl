import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type Escalation = "log" | "nudge" | "ask" | "block";
export type ThingKind = "request" | "artifact" | "note" | "comparison" | "report";
export type ThingStatus = "open" | "answered" | "active" | "done" | "blocked" | "draft";
export type RenderType = "html" | "markdown" | "image" | "diff" | "file" | "gallery" | "form" | "stream";

export type WorkspaceManifest = {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  defaultTabId: string;
};

export type TabManifest = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type ThingResponseOption = {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
};

export type ThingResponseAnswer = {
  choiceId: string;
  note?: string;
  answeredAt: string;
  actor: "human" | "agent";
};

export type ThingManifest = {
  id: string;
  kind: ThingKind;
  title: string;
  summary: string;
  status: ThingStatus;
  escalation: Escalation;
  render: {
    type: RenderType;
    entry: string;
  };
  attachments?: string[];
  needsResponse: boolean;
  response?: {
    type: "single-select";
    prompt: string;
    options: ThingResponseOption[];
    answer?: ThingResponseAnswer;
  };
  createdAt: string;
  updatedAt: string;
};

export type Thing = ThingManifest & {
  content: string;
  tabId: string;
};

export type WorkspaceEvent = {
  id: string;
  ts: string;
  kind: string;
  target: {
    tabId: string;
    thingId: string;
  };
  actor: "human" | "agent";
  payload?: Record<string, unknown>;
};

const WORKSPACE_ROOT = path.join(process.cwd(), ".humanctl");

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function safeReadFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function thingDirectory(tabId: string, thingId: string) {
  return path.join(WORKSPACE_ROOT, "tabs", tabId, "things", thingId);
}

function thingManifestPath(tabId: string, thingId: string) {
  return path.join(thingDirectory(tabId, thingId), "manifest.json");
}

function statusRank(status: ThingStatus) {
  switch (status) {
    case "open":
      return 0;
    case "blocked":
      return 1;
    case "active":
      return 2;
    case "draft":
      return 3;
    case "answered":
      return 4;
    case "done":
      return 5;
    default:
      return 9;
  }
}

export async function readWorkspace(tabId = "main") {
  const workspace = await readJson<WorkspaceManifest>(path.join(WORKSPACE_ROOT, "manifest.json"));
  const tab = await readJson<TabManifest>(path.join(WORKSPACE_ROOT, "tabs", tabId, "manifest.json"));
  const thingRoot = path.join(WORKSPACE_ROOT, "tabs", tabId, "things");
  const thingIds = await fs.readdir(thingRoot);

  const things = (
    await Promise.all(
      thingIds.map(async (thingId) => {
        const manifest = await readJson<ThingManifest>(thingManifestPath(tabId, thingId));
        const content = await safeReadFile(path.join(thingDirectory(tabId, thingId), manifest.render.entry));

        return {
          ...manifest,
          content,
          tabId
        } satisfies Thing;
      })
    )
  ).sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const eventsPath = path.join(WORKSPACE_ROOT, "inbox", "events.jsonl");
  const rawEvents = await safeReadFile(eventsPath);
  const events = rawEvents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as WorkspaceEvent)
    .sort((a, b) => b.ts.localeCompare(a.ts));

  return {
    workspace,
    tab,
    things,
    events
  };
}

export async function answerThing({
  tabId,
  thingId,
  choiceId,
  note
}: {
  tabId: string;
  thingId: string;
  choiceId: string;
  note?: string;
}) {
  const manifestPath = thingManifestPath(tabId, thingId);
  const manifest = await readJson<ThingManifest>(manifestPath);

  if (manifest.response?.type !== "single-select") {
    throw new Error(`Thing ${thingId} is not answerable.`);
  }

  const answeredAt = new Date().toISOString();
  const cleanedNote = note?.trim() ? note.trim() : undefined;

  manifest.status = "answered";
  manifest.needsResponse = false;
  manifest.updatedAt = answeredAt;
  manifest.response.answer = {
    choiceId,
    note: cleanedNote,
    answeredAt,
    actor: "human"
  };

  await writeJson(manifestPath, manifest);

  const eventsPath = path.join(WORKSPACE_ROOT, "inbox", "events.jsonl");
  const event: WorkspaceEvent = {
    id: `evt_${randomUUID().slice(0, 8)}`,
    ts: answeredAt,
    kind: "answered",
    target: {
      tabId,
      thingId
    },
    actor: "human",
    payload: {
      choiceId,
      note: cleanedNote
    }
  };

  await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}
