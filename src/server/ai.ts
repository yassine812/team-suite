import { aiBaseUrl, createGatewayFetch, refusalFromError } from "@every-app/sdk/server";
import { z } from "zod";

export const aiInput = z
  .object({
    mode: z.enum(["draft", "rewrite", "summarize"]),
    prompt: z.string().max(2000).default(""),
    draft: z.string().max(20000).default(""),
    thread: z.string().max(40000).default(""),
  })
  .strict();

/** A small, inexpensive chat model on OpenRouter. */
const MODEL = "openai/gpt-4o-mini";

const INSTRUCTIONS = {
  draft: "Write a short, plain email body for the request below. Return only the body text.",
  rewrite: "Rewrite the email draft below to read clearly and politely, following any instruction given. Return only the new body text.",
  summarize: "Summarize this email thread in a few short bullet points. Return only the summary.",
};

/** One completion through the Gateway's OpenRouter key; off when none is connected. */
export async function assist(env: Cloudflare.Env, input: z.infer<typeof aiInput>): Promise<{ text: string } | { off: true } | { error: string }> {
  const user = [
    input.prompt && `Instruction: ${input.prompt}`,
    input.draft && `Draft:\n${input.draft}`,
    input.thread && `Thread:\n${input.thread}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const fetcher = createGatewayFetch({ env });
    const res = await fetcher(`${aiBaseUrl("openrouter")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: INSTRUCTIONS[input.mode] }, { role: "user", content: user || "(empty)" }] }),
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 401 || res.status === 403 || /not_configured|not_allowed|capability_not_requested/.test(body)) return { off: true };
      return { error: "The AI request failed. Try again." };
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return { text: json.choices?.[0]?.message?.content?.trim() ?? "" };
  } catch (error) {
    if (refusalFromError(error)) return { off: true };
    throw error;
  }
}
