// Sends Telegram notifications for B2B leads, event orders, and complaints.

export type TelegramParams =
  | { segment: "b2b"; contacto: string; negocio: string; ciudad: string; whatsapp: string; senderId: string; username?: string | null }
  | { segment: "evento"; nombre: string; localidad: string; cantidad: string; whatsapp: string; senderId: string; username?: string | null }
  | { segment: "queja"; nombre: string; whatsapp: string; descripcion: string; senderId: string; username?: string | null }
  | { segment: "confusion"; nombre: string; whatsapp: string; consulta: string; senderId: string; username?: string | null };

const PAGE_USERNAME = (process.env["INSTAGRAM_PAGE_USERNAME"] ?? "lalemanafoods").toLowerCase();

function buildMessage(params: TelegramParams): string {
  const isOwnPage = params.username?.toLowerCase() === PAGE_USERNAME;
  const igLink = (params.username && !isOwnPage)
    ? `https://www.instagram.com/${params.username}/`
    : `https://www.instagram.com/direct/t/${params.senderId}`;
  if (params.segment === "b2b") {
    return (
      `🏷️ <b>Nuevo Interesado Mayorista</b>\n` +
      `👤 Contacto: ${params.contacto}\n` +
      `🏪 Negocio: ${params.negocio} | 📍 ${params.ciudad} | 📱 WhatsApp: ${params.whatsapp}\n` +
      `🔗 IG: ${igLink}`
    );
  }
  if (params.segment === "evento") {
    return (
      `🎉 <b>Nuevo Pedido para Evento (+10kg)</b>\n` +
      `${params.nombre} | 📍 ${params.localidad} | ⚖️ ${params.cantidad} | 📱 WhatsApp: ${params.whatsapp}\n` +
      `🔗 IG: ${igLink}`
    );
  }
  if (params.segment === "confusion") {
    return (
      `🧩 <b>Consulta Técnica/Compleja</b>\n` +
      `${params.nombre} | 📱 WhatsApp: ${params.whatsapp}\n` +
      `❓ Consulta: ${params.consulta.slice(0, 300)}\n` +
      `🔗 IG: ${igLink}`
    );
  }
  return (
    `⚠️ <b>Nuevo Reclamo Recibido</b>\n` +
    `Cliente: ${params.nombre} | 📱 WhatsApp: ${params.whatsapp}\n` +
    `📋 Problema: ${params.descripcion.slice(0, 300)}\n` +
    `🔗 IG: ${igLink}`
  );
}

export async function sendTelegramNotification(params: TelegramParams): Promise<void> {
  const token = process.env["IG_TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["IG_TELEGRAM_CHAT_ID"];

  if (!token || !chatId) {
    console.warn("[instagram] Telegram no configurado: faltan IG_TELEGRAM_BOT_TOKEN o IG_TELEGRAM_CHAT_ID");
    return;
  }

  try {
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildMessage(params),
        parse_mode: "HTML",
      }),
    });

    if (!resp.ok) {
      console.error(`[instagram] Telegram API error ${resp.status}: ${await resp.text()}`);
    }
  } catch (err) {
    console.error("[instagram] Error enviando notificación Telegram:", err);
  }
}
