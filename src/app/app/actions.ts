"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { answerAsk } from "@/lib/humanctl";

export async function submitAskResponse(formData: FormData) {
  const askId = String(formData.get("askId") ?? "");
  const choiceValue = formData.get("choiceId");
  const choiceId = typeof choiceValue === "string" ? choiceValue : "";
  const note = String(formData.get("note") ?? "");

  if (!askId || (!choiceId && !note.trim())) {
    return;
  }

  await answerAsk({
    askId,
    choiceId,
    note
  });

  revalidatePath("/app");
  redirect(`/app?ask=${askId}`);
}
