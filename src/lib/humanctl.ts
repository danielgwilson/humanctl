import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type Escalation = "log" | "nudge" | "ask" | "block";
export type RenderType = "html" | "markdown" | "image" | "diff" | "file" | "gallery" | "form" | "stream";
export type TargetType = "ask" | "artifact" | "watch";

export type WorkspaceManifest = {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  defaultTabId?: string;
};

export type AskStatus = "open" | "answered" | "blocked" | "snoozed" | "draft";
export type WatchStatus = "active" | "quiet" | "paused" | "blocked" | "done";

export type AskResponseOption = {
  id: string;
  label: string;
  description: string;
  recommended?: boolean;
};

export type AskResponseAnswer = {
  choiceId: string;
  note?: string;
  answeredAt: string;
  actor: "human" | "agent";
};

export const CUSTOM_NOTE_CHOICE_ID = "__note__";

export type AskManifest = {
  id: string;
  title: string;
  summary: string;
  status: AskStatus;
  escalation: Escalation;
  prompt: string;
  whyNow?: string;
  ifIgnored?: string;
  artifactIds: string[];
  watchIds?: string[];
  response: {
    type: "single-select";
    options: AskResponseOption[];
    answer?: AskResponseAnswer;
  };
  createdAt: string;
  updatedAt: string;
};

export type Ask = AskManifest;

export type ArtifactManifest = {
  id: string;
  kind: "preview" | "dashboard" | "note" | "report" | "comparison";
  title: string;
  summary: string;
  status?: "active" | "done" | "draft";
  labels?: string[];
  pinned?: boolean;
  render: {
    type: RenderType;
    entry: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type Artifact = ArtifactManifest & {
  content: string;
};

export type WatchManifest = {
  id: string;
  title: string;
  summary: string;
  status: WatchStatus;
  escalation: Escalation;
  kind: "presence" | "command" | "file" | "external";
  conditionSummary: string;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceEvent = {
  id: string;
  ts: string;
  kind: string;
  target: {
    type: TargetType;
    id: string;
  };
  actor: "human" | "agent";
  payload?: Record<string, unknown>;
};

const WORKSPACE_ROOT = process.env.HUMANCTL_WORKSPACE_ROOT
  ? path.resolve(process.env.HUMANCTL_WORKSPACE_ROOT)
  : path.join(process.cwd(), ".humanctl");

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function writeJson(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

async function safeReadFile(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function safeReadDir(dirPath: string) {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

function askDirectory(askId: string) {
  return path.join(WORKSPACE_ROOT, "asks", askId);
}

function askManifestPath(askId: string) {
  return path.join(askDirectory(askId), "manifest.json");
}

function artifactDirectory(artifactId: string) {
  return path.join(WORKSPACE_ROOT, "artifacts", artifactId);
}

function artifactManifestPath(artifactId: string) {
  return path.join(artifactDirectory(artifactId), "manifest.json");
}

function watchDirectory(watchId: string) {
  return path.join(WORKSPACE_ROOT, "watches", watchId);
}

function watchManifestPath(watchId: string) {
  return path.join(watchDirectory(watchId), "manifest.json");
}

function askStatusRank(status: AskStatus) {
  switch (status) {
    case "blocked":
      return 0;
    case "open":
      return 1;
    case "draft":
      return 2;
    case "answered":
      return 3;
    case "snoozed":
      return 4;
    default:
      return 9;
  }
}

function watchStatusRank(status: WatchStatus) {
  switch (status) {
    case "blocked":
      return 0;
    case "active":
      return 1;
    case "quiet":
      return 2;
    case "paused":
      return 3;
    case "done":
      return 4;
    default:
      return 9;
  }
}

function artifactRank(artifact: ArtifactManifest) {
  return artifact.pinned ? 0 : 1;
}

export async function readWorkspace() {
  const workspace = await readJson<WorkspaceManifest>(path.join(WORKSPACE_ROOT, "manifest.json"));

  const askIds = await safeReadDir(path.join(WORKSPACE_ROOT, "asks"));
  const asks = (
    await Promise.all(
      askIds.map(async (askId) => readJson<AskManifest>(askManifestPath(askId)))
    )
  ).sort((a, b) => {
    const rankDiff = askStatusRank(a.status) - askStatusRank(b.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const artifactIds = await safeReadDir(path.join(WORKSPACE_ROOT, "artifacts"));
  const artifacts = (
    await Promise.all(
      artifactIds.map(async (artifactId) => {
        const manifest = await readJson<ArtifactManifest>(artifactManifestPath(artifactId));
        const content = await safeReadFile(path.join(artifactDirectory(artifactId), manifest.render.entry));

        return {
          ...manifest,
          content
        } satisfies Artifact;
      })
    )
  ).sort((a, b) => {
    const rankDiff = artifactRank(a) - artifactRank(b);
    if (rankDiff !== 0) {
      return rankDiff;
    }

    return b.updatedAt.localeCompare(a.updatedAt);
  });

  const watchIds = await safeReadDir(path.join(WORKSPACE_ROOT, "watches"));
  const watches = (
    await Promise.all(
      watchIds.map(async (watchId) => readJson<WatchManifest>(watchManifestPath(watchId)))
    )
  ).sort((a, b) => {
    const rankDiff = watchStatusRank(a.status) - watchStatusRank(b.status);
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
    asks,
    artifacts,
    watches,
    events
  };
}

export async function answerAsk({
  askId,
  choiceId,
  note
}: {
  askId: string;
  choiceId?: string;
  note?: string;
}) {
  const manifestPath = askManifestPath(askId);
  const manifest = await readJson<AskManifest>(manifestPath);

  if (manifest.response.type !== "single-select") {
    throw new Error(`Ask ${askId} is not answerable.`);
  }

  const answeredAt = new Date().toISOString();
  const cleanedNote = note?.trim() ? note.trim() : undefined;
  const resolvedChoiceId = choiceId?.trim() ? choiceId.trim() : CUSTOM_NOTE_CHOICE_ID;

  if (!choiceId?.trim() && !cleanedNote) {
    throw new Error(`Ask ${askId} requires either a choice or a note.`);
  }

  manifest.status = "answered";
  manifest.updatedAt = answeredAt;
  manifest.response.answer = {
    choiceId: resolvedChoiceId,
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
      type: "ask",
      id: askId
    },
    actor: "human",
    payload: {
      choiceId: resolvedChoiceId,
      note: cleanedNote
    }
  };

  await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
}
