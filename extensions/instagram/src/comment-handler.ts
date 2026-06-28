// Handles public Instagram comment events and invites users to DM.
// Never resolves full queries in comments — only redirects to private conversation.

import { sendCommentReply } from "./instagram-api.js";

const repliedComments = new Set<string>();

const COMMENT_B2C_KEYWORDS = [
  // dónde comprar / conseguir
  "donde comprar", "dónde comprar", "donde conseguir", "dónde conseguir",
  "donde lo consigo", "donde encuentro", "dónde encuentro",
  "donde venden", "dónde venden", "donde lo venden",
  // cómo comprar
  "como se compra", "cómo se compra", "como compro", "cómo compro",
  "como consigo", "cómo consigo", "como lo consigo", "cómo lo consigo",
  "como los consigo", "como las consigo",
  // puntos de venta
  "punto de venta", "puntos de venta",
  // envíos y disponibilidad
  "hacen envios", "hacen envíos", "envio", "envíos", "mandan a",
  "despachan", "llegan a", "tienen en", "hay en",
  // ubicaciones argentinas abreviadas
  "bs as", "bsas", "capital federal", "caba",
];

const COMMENT_B2B_KEYWORDS = [
  "reventa", "revendedor", "revendedora", "mayorista", "por mayor",
  "distribucion", "distribución", "distribuir", "ser distribuidor",
  "trabajar con", "vender sus productos", "vender los productos",
  "para mi negocio", "precio mayorista", "lista de precios",
  "me interesa distribuir", "interesa vender",
];

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

type CommentIntent = "b2c" | "b2b" | "ignore";

function classifyComment(text: string): CommentIntent {
  const q = normalize(text);
  if (COMMENT_B2B_KEYWORDS.some((kw) => q.includes(normalize(kw)))) return "b2b";
  if (COMMENT_B2C_KEYWORDS.some((kw) => q.includes(normalize(kw)))) return "b2c";
  return "ignore";
}

function pick(items: string[]): string {
  return items[Math.floor(Math.random() * items.length)]!;
}

function replyTextB2C(): string {
  return pick([
    "¡Hola! Te van a encantar 🇩🇪 Escribinos por DM y te indico personalmente dónde podés comprarlas hoy mismo según tu barrio 😊",
    "¡Hola! 🇩🇪 Escribinos por DM y te indico personalmente dónde podés comprarlas según tu barrio 😊",
    "¡Hola! 🌭 Mandanos un DM y te ayudamos personalmente a encontrar el punto de venta más cercano según tu zona.",
    "¡Claro! 😊 Escribinos por privado y te recomendamos dónde conseguirlas cerca tuyo.",
    "¡Hola! 🙌 Por DM te paso los puntos de venta más cercanos según dónde estés.",
    "¡Hola! 🇩🇪 Escribinos y vemos juntos cuál te queda más cómodo para conseguirlas 😊",
  ]);
}

function replyTextB2B(): string {
  return pick([
    "¡Qué bueno leer eso! 🙌 Escribinos por DM y te contamos personalmente cómo podemos trabajar juntos.",
    "¡Nos encanta tu interés! 🌭 Mandanos un privado y seguimos por ahí con muchísimo gusto.",
    "¡Gracias por escribirnos! 😊 Escribinos por DM y el equipo comercial te asesora personalmente.",
  ]);
}

export type CommentChangeValue = {
  id: string;
  text?: string;
  from?: { id: string; username?: string };
  media?: { id: string; media_product_type?: string };
  timestamp?: number;
};

export async function processCommentChange(value: CommentChangeValue): Promise<void> {
  const commentId = value.id;
  const text = value.text ?? "";
  const fromId = value.from?.id;
  const pageId = process.env["INSTAGRAM_PAGE_ID"];

  if (fromId && pageId && fromId === pageId) return;

  if (repliedComments.has(commentId)) {
    console.info(`[instagram] comentario ${commentId} ya respondido, ignorando`);
    return;
  }

  const intent = classifyComment(text);
  if (intent === "ignore") {
    console.info(`[instagram] comentario ${commentId} sin intención comercial, ignorando`);
    return;
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 3000 + Math.floor(Math.random() * 4000)));

  const reply = intent === "b2b" ? replyTextB2B() : replyTextB2C();
  console.info(`[instagram] respondiendo comentario ${commentId} intent=${intent}`);
  await sendCommentReply(commentId, reply);
  repliedComments.add(commentId);
}
