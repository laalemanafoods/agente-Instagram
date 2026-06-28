// Sends replies to Instagram DMs via the Meta Graph API.
// The direct-chat link (/direct/t/{id}) only opens the inbox, not the profile.
// We fetch the username so Telegram notifications link to the profile instead.

export async function fetchInstagramUsername(senderId: string): Promise<string | null> {
  const accessToken = process.env["INSTAGRAM_ACCESS_TOKEN"];
  if (!accessToken) return null;
  try {
    const resp = await fetch(
      `https://graph.instagram.com/v25.0/${senderId}?fields=username&access_token=${accessToken}`,
    );
    if (!resp.ok) return null;
    const data = await resp.json() as { username?: string };
    return data.username ?? null;
  } catch {
    return null;
  }
}

export async function sendCommentReply(commentId: string, message: string): Promise<void> {
  const accessToken = process.env["INSTAGRAM_ACCESS_TOKEN"];
  if (!accessToken) {
    console.warn("[instagram] INSTAGRAM_ACCESS_TOKEN no configurado");
    return;
  }
  try {
    const resp = await fetch(`https://graph.instagram.com/v25.0/${commentId}/replies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: accessToken }),
    });
    if (!resp.ok) {
      console.error(`[instagram] Error respondiendo comentario ${resp.status}: ${await resp.text()}`);
    }
  } catch (err) {
    console.error("[instagram] Error respondiendo comentario:", err);
  }
}

export async function sendInstagramReply(params: {
  recipientId: string;
  text: string;
}): Promise<void> {
  const accessToken = process.env["INSTAGRAM_ACCESS_TOKEN"];
  const pageId = process.env["INSTAGRAM_PAGE_ID"];

  if (!accessToken || !pageId) {
    console.warn(
      "[instagram] Instagram API no configurada: faltan INSTAGRAM_ACCESS_TOKEN o INSTAGRAM_PAGE_ID",
    );
    return;
  }

  const MAX_CHARS = 990;
  const text =
    params.text.length > MAX_CHARS
      ? params.text.slice(0, MAX_CHARS - 3).trimEnd() + "..."
      : params.text;

  try {
    const resp = await fetch(`https://graph.instagram.com/v25.0/${pageId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipient: { id: params.recipientId },
        message: { text },
        messaging_type: "RESPONSE",
        access_token: accessToken,
      }),
    });

    if (!resp.ok) {
      console.error(`[instagram] Meta Graph API error ${resp.status}: ${await resp.text()}`);
    }
  } catch (err) {
    console.error("[instagram] Error enviando respuesta Instagram:", err);
  }
}
