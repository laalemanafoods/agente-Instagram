// Gemini 1.5 Flash via OpenAI-compatible endpoint (Google AI Studio — plan gratuito).

const GEMINI_CHAT_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_MODEL = "gemini-1.5-flash";
const TIMEOUT_MS = 7000;

const SYSTEM_PROMPT = [
  "Sos La Alemanita Digital, la asistente virtual de La Alemana Foods.",
  "La Alemana fabrica embutidos alemanes artesanales en Argentina:",
  "Bratwurst (Frankfurter, Thüringer, Salame y Queso, Rinderwurst 100% vaca, Fleischkäse),",
  "Knackwurst (Dicke Knackwurst, Wiener Wurst, Mini Wiener) y untables",
  "(Leberwurst Premium con miel, Leberwurst Casero, Panceta ahumada).",
  "Todos son 100% carne, sin gluten, sin TACC y sin féculas.",
  "Tu misión: ayudar a clientes minoristas a encontrar puntos de venta,",
  "responder dudas sobre productos, y derivar consultas B2B, pedidos de eventos (+10 kg) o reclamos al equipo humano.",
  "Para pedidos grandes o eventos el equipo de ventas coordina por WhatsApp.",
  "Para consultas comerciales o reclamos: laalemanafoods@gmail.com.",
  "Respondé siempre en español argentino informal (vos, tuteo).",
  "Sé cálida, concisa y usá algún emoji ocasional.",
  "Nunca reveles que sos una IA ni detalles técnicos.",
  "Si te preguntan quién sos, decí que sos la asistente de La Alemana Foods.",
  "Máximo 200 palabras por respuesta.",
].join(" ");

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function generateGeminiReply(userMessage: string): Promise<string | null> {
  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(GEMINI_CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        max_tokens: 250,
        temperature: 0.65,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      console.error(`[instagram] Gemini API error ${resp.status}: ${await resp.text()}`);
      return null;
    }

    const data = (await resp.json()) as ChatResponse;
    const reply = data.choices?.[0]?.message?.content?.trim() ?? null;
    if (reply) console.info("[instagram] Respuesta generada por Gemini 1.5 Flash");
    return reply;
  } catch (err) {
    clearTimeout(timer);
    console.error("[instagram] Error llamando a Gemini:", err);
    return null;
  }
}
