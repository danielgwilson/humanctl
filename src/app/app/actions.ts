"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { answerThing } from "@/lib/humanctl";

export async function submitThingResponse(formData: FormData) {
  const tabId = String(formData.get("tabId") ?? "main");
  const thingId = String(formData.get("thingId") ?? "");
  const choiceId = String(formData.get("choiceId") ?? "");
  const note = String(formData.get("note") ?? "");

  if (!thingId || !choiceId) {
    return;
  }

  await answerThing({
    tabId,
    thingId,
    choiceId,
    note
  });

  revalidatePath("/app");
  redirect(`/app?thing=${thingId}`);
}
