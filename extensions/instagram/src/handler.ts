// HTTP handler for Instagram webhook verification (GET) and message events (POST).

import type { IncomingMessage, ServerResponse } from "node:http";
import { classifyMessage } from "./classifier.js";
import { processCommentChange, type CommentChangeValue } from "./comment-handler.js";
import { sendInstagramReply, fetchInstagramUsername } from "./instagram-api.js";
import {
  findByBarrioOnly,
  findByCityOnly,
  getAllForCity,
  getBarrioCities,
  getOnlineStoreUrl,
  groupByBarrio,
  hasDistinctBarrios,
} from "./puntos-de-venta.js";
import { RESPONSES } from "./responses.js";
import { getSession, setSession, incrementConfusion, resetConfusion, markAsStaff, isStaff, incrementTroll, resetTroll, markAsHumanManaged, isHumanManaged, updateLastActivity } from "./session-store.js";
import { sendTelegramNotification } from "./telegram.js";

// ---------------------------------------------------------------------------
// Test Mode Filter
// ---------------------------------------------------------------------------
function isTestModeEnabled(): boolean {
  const raw = process.env["INSTAGRAM_TEST_MODE"];
  if (!raw) return true;
  return raw.trim().toLowerCase() !== "false" && raw.trim() !== "0";
}

function isAllowedInTestMode(senderId: string, text: string): boolean {
  if (!isTestModeEnabled()) return true;
  const authorizedSenderId = process.env["INSTAGRAM_TEST_SENDER_ID"]?.trim();
  if (authorizedSenderId && senderId === authorizedSenderId) return true;
  if (text.includes("ACTIVAR_TEST")) return true;
  return false;
}

type MessagingEvent = {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: { mid: string; text?: string };
};

type InstagramWebhookPayload = {
  object: string;
  entry: Array<{
    id: string;
    time: number;
    messaging: MessagingEvent[];
    changes: Array<{ field: string; value: unknown }>;
  }>;
};

async function readBody(req: IncomingMessage, maxBytes = 512 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) { reject(new Error("Payload too large")); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function extractField(text: string, fieldName: string): string | undefined {
  const regex = new RegExp(
    `${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:\\-\\s]+([^\\n•\\-,]+)`,
    "i",
  );
  const match = text.match(regex);
  return match?.[1]?.trim() || undefined;
}

function extractPhone(text: string): string | undefined {
  const match = text.match(/(?:tel[eé]fono|tel|cel|celular|whatsapp|wp|wsp)?[:\s]*(\+?[\d\s\-()]{7,})/i);
  return match?.[1]?.trim() || undefined;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const PURCHASE_KEYWORDS = [
  "donde comprar", "dónde comprar", "donde conseguir", "dónde conseguir",
  "donde lo consigo", "donde encuentro", "dónde encuentro",
  "punto de venta", "puntos de venta", "donde venden", "dónde venden",
];

function askingWhereToBuy(text: string): boolean {
  const q = normalize(text);
  return PURCHASE_KEYWORDS.some((kw) => q.includes(normalize(kw)));
}

const GREETING_WORDS = new Set([
  "hola", "buenas", "buen", "buenos", "dias", "dia",
  "tardes", "noches", "mananas", "hi", "hey", "saludos", "ola",
]);

function isJustGreeting(text: string): boolean {
  const words = normalize(text)
    .replace(/[!?¡¿.,]+/g, " ")
    .replace(/(.)\1{2,}/g, "$1")  // collapse holaaaa → hola
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 && words.every((w) => GREETING_WORDS.has(w));
}

const AI_KEYWORDS = [
  "chatgpt", "openai", "anthropic", "claude", "gemini", "gpt-4", "gpt4", "gpt 4",
  "qué ia", "que ia", "sos ia", "sos una ia", "eres una ia",
  "sos un robot", "eres un robot", "sos un bot", "eres un bot",
  "modelo de ia", "inteligencia artificial", "machine learning",
  "qué modelo", "que modelo", "qué tecnología", "que tecnologia",
  "quien te programo", "quién te programó", "como funcionas", "cómo funcionás",
  "qué sos vos", "que sos vos",
];

function askingAboutAI(text: string): boolean {
  const q = normalize(text);
  return AI_KEYWORDS.some((kw) => q.includes(normalize(kw)));
}

const AMBIGUOUS_WORDS = new Set([
  "ok", "dale", "aja", "aha", "ya", "listo", "entendido",
  "jaja", "jeje", "jajaja", "jejeje", "kk", "jj",
]);

function isAmbiguous(text: string): boolean {
  const q = normalize(text).replace(/[!?¡¿.,\s]+/g, " ").trim();
  if (q.length <= 2) return true;
  const words = q.split(/\s+/).filter(Boolean);
  return words.length === 1 && AMBIGUOUS_WORDS.has(words[0]!);
}

function mentionsBarrioKeyword(text: string): boolean {
  return normalize(text).split(/\s+/).includes("barrio");
}

const PRODUCT_KEYWORDS = [
  "salchicha", "salchichas", "salame", "salami", "salamín", "salamines",
  "bondiola", "jamon", "jamón", "fiambre", "fiambres", "mortadela",
  "chorizo", "longaniza", "panceta", "prosciutto", "frankfurt",
  "leberwurst", "pastrón", "pastron",
];

function mentionsProduct(text: string): boolean {
  const q = normalize(text);
  return PRODUCT_KEYWORDS.some((kw) => q.includes(normalize(kw)));
}

// Ciudades y provincias argentinas sin puntos de venta en la DB
const KNOWN_ARGENTINE_LOCATIONS: string[] = [
  "San Juan", "Salta", "Mendoza", "Tucumán", "Jujuy",
  "Corrientes", "Chaco", "Formosa", "Misiones", "Entre Ríos",
  "La Rioja", "Catamarca", "Santiago del Estero", "La Pampa",
  "Río Negro", "Chubut", "Santa Cruz", "Tierra del Fuego",
  "San Luis", "San Rafael", "Bariloche", "Resistencia", "Posadas",
  "Paraná", "Mar del Plata", "Bahía Blanca", "La Plata",
  "Tandil", "Lomas de Zamora", "Quilmes", "Lanús", "Avellaneda",
];

function findKnownArgentineLocation(text: string): string | null {
  const q = normalize(text);
  for (const loc of KNOWN_ARGENTINE_LOCATIONS) {
    if (q.includes(normalize(loc))) return loc;
  }
  return null;
}

// Localidades del GBA → tienda más cercana
// GBA Norte → Sin Gluten Olivos | GBA Oeste y Sur → tiendas de Buenos Aires
const GBA_NORTE_LOCATIONS: Array<{ name: string; mappedCity: string }> = [
  // --- GBA NORTE → Olivos ---
  // Tigre
  { name: "Don Torcuato", mappedCity: "Olivos" },
  { name: "General Pacheco", mappedCity: "Olivos" },
  { name: "Pacheco", mappedCity: "Olivos" },
  { name: "Tigre", mappedCity: "Olivos" },
  { name: "Benavídez", mappedCity: "Olivos" },
  { name: "Nordelta", mappedCity: "Olivos" },
  { name: "El Talar", mappedCity: "Olivos" },
  { name: "Ricardo Rojas", mappedCity: "Olivos" },
  { name: "Rincón de Milberg", mappedCity: "Olivos" },
  // San Fernando
  { name: "San Fernando", mappedCity: "Olivos" },
  { name: "Victoria", mappedCity: "Olivos" },
  { name: "Virreyes", mappedCity: "Olivos" },
  // San Isidro
  { name: "San Isidro", mappedCity: "Olivos" },
  { name: "Martínez", mappedCity: "Olivos" },
  { name: "Acassuso", mappedCity: "Olivos" },
  { name: "Boulogne", mappedCity: "Olivos" },
  { name: "La Lucila", mappedCity: "Olivos" },
  { name: "Beccar", mappedCity: "Olivos" },
  // Vicente López
  { name: "Vicente López", mappedCity: "Olivos" },
  { name: "Florida", mappedCity: "Olivos" },
  { name: "Munro", mappedCity: "Olivos" },
  { name: "Villa Adelina", mappedCity: "Olivos" },
  { name: "Carapachay", mappedCity: "Olivos" },
  // San Martín partido
  { name: "San Martín", mappedCity: "Olivos" },
  { name: "Villa Ballester", mappedCity: "Olivos" },
  { name: "José León Suárez", mappedCity: "Olivos" },
  { name: "Villa Lynch", mappedCity: "Olivos" },
  { name: "Villa Maipú", mappedCity: "Olivos" },
  // Malvinas Argentinas / José C. Paz / San Miguel
  { name: "Los Polvorines", mappedCity: "Olivos" },
  { name: "Grand Bourg", mappedCity: "Olivos" },
  { name: "Tortuguitas", mappedCity: "Olivos" },
  { name: "Malvinas Argentinas", mappedCity: "Olivos" },
  { name: "José C. Paz", mappedCity: "Olivos" },
  { name: "San Miguel", mappedCity: "Olivos" },
  { name: "Bella Vista", mappedCity: "Olivos" },
  // Corredor Pilar / Escobar
  { name: "Pilar", mappedCity: "Olivos" },
  { name: "Del Viso", mappedCity: "Olivos" },
  { name: "Escobar", mappedCity: "Olivos" },
  { name: "Garín", mappedCity: "Olivos" },
  { name: "Maquinista Savio", mappedCity: "Olivos" },
  { name: "Ingeniero Maschwitz", mappedCity: "Olivos" },
  { name: "Belén de Escobar", mappedCity: "Olivos" },
  { name: "Zárate", mappedCity: "Olivos" },

  // --- GBA OESTE → Buenos Aires ---
  // Morón
  { name: "Morón", mappedCity: "Buenos Aires" },
  { name: "Haedo", mappedCity: "Buenos Aires" },
  { name: "El Palomar", mappedCity: "Buenos Aires" },
  { name: "Castelar", mappedCity: "Buenos Aires" },
  // Tres de Febrero
  { name: "Caseros", mappedCity: "Buenos Aires" },
  { name: "Ciudadela", mappedCity: "Buenos Aires" },
  { name: "Villa Bosch", mappedCity: "Buenos Aires" },
  { name: "Pablo Podestá", mappedCity: "Buenos Aires" },
  { name: "Sáenz Peña", mappedCity: "Buenos Aires" },
  // Hurlingham / Ituzaingó
  { name: "Hurlingham", mappedCity: "Buenos Aires" },
  { name: "William Morris", mappedCity: "Buenos Aires" },
  { name: "Ituzaingó", mappedCity: "Buenos Aires" },
  { name: "Padua", mappedCity: "Buenos Aires" },
  // Moreno
  { name: "Moreno", mappedCity: "Buenos Aires" },
  { name: "Francisco Álvarez", mappedCity: "Buenos Aires" },
  { name: "Cuartel V", mappedCity: "Buenos Aires" },
  // Merlo
  { name: "Merlo", mappedCity: "Buenos Aires" },
  { name: "San Antonio de Padua", mappedCity: "Buenos Aires" },
  // La Matanza
  { name: "San Justo", mappedCity: "Buenos Aires" },
  { name: "Ramos Mejía", mappedCity: "Buenos Aires" },
  { name: "La Tablada", mappedCity: "Buenos Aires" },
  { name: "Villa Luzuriaga", mappedCity: "Buenos Aires" },
  { name: "Ciudad Evita", mappedCity: "Buenos Aires" },
  { name: "González Catán", mappedCity: "Buenos Aires" },
  { name: "Isidro Casanova", mappedCity: "Buenos Aires" },
  { name: "Laferrere", mappedCity: "Buenos Aires" },
  { name: "Gregorio de Laferrere", mappedCity: "Buenos Aires" },
  // General Rodríguez / Luján
  { name: "General Rodríguez", mappedCity: "Buenos Aires" },
  { name: "Luján", mappedCity: "Buenos Aires" },

  // --- GBA SUR → Buenos Aires ---
  // Avellaneda
  { name: "Avellaneda", mappedCity: "Buenos Aires" },
  { name: "Wilde", mappedCity: "Buenos Aires" },
  { name: "Sarandí", mappedCity: "Buenos Aires" },
  { name: "Villa Domínico", mappedCity: "Buenos Aires" },
  // Lanús
  { name: "Lanús", mappedCity: "Buenos Aires" },
  { name: "Remedios de Escalada", mappedCity: "Buenos Aires" },
  { name: "Monte Chingolo", mappedCity: "Buenos Aires" },
  // Lomas de Zamora
  { name: "Lomas de Zamora", mappedCity: "Buenos Aires" },
  { name: "Banfield", mappedCity: "Buenos Aires" },
  { name: "Temperley", mappedCity: "Buenos Aires" },
  { name: "Turdera", mappedCity: "Buenos Aires" },
  // Quilmes
  { name: "Quilmes", mappedCity: "Buenos Aires" },
  { name: "Bernal", mappedCity: "Buenos Aires" },
  { name: "Ezpeleta", mappedCity: "Buenos Aires" },
  { name: "Don Bosco", mappedCity: "Buenos Aires" },
  // Almirante Brown
  { name: "Adrogué", mappedCity: "Buenos Aires" },
  { name: "Burzaco", mappedCity: "Buenos Aires" },
  { name: "Longchamps", mappedCity: "Buenos Aires" },
  { name: "Claypole", mappedCity: "Buenos Aires" },
  { name: "Glew", mappedCity: "Buenos Aires" },
  // Esteban Echeverría / Ezeiza
  { name: "Monte Grande", mappedCity: "Buenos Aires" },
  { name: "El Jagüel", mappedCity: "Buenos Aires" },
  { name: "Ezeiza", mappedCity: "Buenos Aires" },
  { name: "Tristán Suárez", mappedCity: "Buenos Aires" },
  // Berazategui
  { name: "Berazategui", mappedCity: "Buenos Aires" },
  { name: "Ranelagh", mappedCity: "Buenos Aires" },
  // Florencio Varela
  { name: "Florencio Varela", mappedCity: "Buenos Aires" },
  { name: "Bosques", mappedCity: "Buenos Aires" },
  // Presidente Perón / San Vicente
  { name: "Guernica", mappedCity: "Buenos Aires" },
  { name: "San Vicente", mappedCity: "Buenos Aires" },
];

function findGBANorte(text: string): { name: string; mappedCity: string } | null {
  const q = normalize(text);
  for (const loc of GBA_NORTE_LOCATIONS) {
    if (q.includes(normalize(loc.name))) return loc;
  }
  return null;
}

async function sendGBANorteReply(senderId: string, locName: string, mappedCity: string): Promise<void> {
  try {
    const nearbyStores = getAllForCity(mappedCity);
    setSession(senderId, { segment: "consumer" });
    let text: string;
    if (hasDistinctBarrios(nearbyStores)) {
      const groups = groupByBarrio(nearbyStores);
      text = RESPONSES.consumer.storeFoundNearbyGrouped(locName, mappedCity, groups);
    } else {
      text = RESPONSES.consumer.storeFoundNearby(locName, nearbyStores);
    }
    await sendInstagramReply({ recipientId: senderId, text });
  } catch (err) {
    console.error(`[instagram] Error buscando tienda GBA para ${locName}:`, err);
    setSession(senderId, { segment: "consumer", step: "asking_city" });
    await sendInstagramReply({
      recipientId: senderId,
      text: "Disculpame, se me complicó buscar esa zona. 😅 ¿Me podés decir otra localidad o barrio cercano para guiarte mejor?",
    });
  }
}

const OFF_TOPIC_PATTERNS = [
  // Construcción y materiales
  "cemento", "ladrillo", "ladrillos", "construccion", "construcción",
  "ferreteria", "ferretería", "hormigon", "hormigón", "plomero", "plomeria", "plomería",
  // Electrónica absurda aplicada a comida
  "wifi", "bluetooth",
  // Automotor / combustibles
  "repuesto", "nafta", "gasoil",
];

function isOffTopic(text: string): boolean {
  const q = normalize(text);
  return OFF_TOPIC_PATTERNS.some((p) => q.includes(normalize(p)));
}

const WHATSAPP_SHIPPING_KEYWORDS = [
  "whatsapp", "wsp", "wp",
  "envío", "envio", "envíos", "envios",
  "retiro", "retiran", "retirar", "retira",
  "entrega", "entregan", "te entregan",
  "delivery",
  "mandan", "lo mandan", "me mandan",
  "pedido por", "compra por",
  "comprar por whatsapp", "pedir por",
  "llega a casa", "a domicilio",
  "cómo se compra", "como se compra",
  "cómo compro", "como compro",
  "cómo pido", "como pido",
  "cómo es el tema", "como es el tema",
  "cómo funciona el", "como funciona el",
];

function askingAboutWhatsAppOrShipping(text: string): boolean {
  const q = normalize(text);
  return WHATSAPP_SHIPPING_KEYWORDS.some((kw) => q.includes(normalize(kw)));
}

const PRICE_KEYWORDS = [
  "precio", "precios", "cuánto cuesta", "cuanto cuesta", "cuánto sale", "cuanto sale",
  "cuánto vale", "cuanto vale", "cuánto están", "cuanto estan", "qué precio",
  "que precio", "tienen precio", "precio tiene", "cuánto cobran", "cuanto cobran",
  "precio de", "valor de", "cuánto es", "cuanto es",
];

function askingAboutPrice(text: string): boolean {
  const q = normalize(text);
  return PRICE_KEYWORDS.some((kw) => q.includes(normalize(kw)));
}

const INGREDIENT_KEYWORDS = [
  "sin gluten", "sin tacc", "tacc", "gluten", "celiaco", "celíaco", "celiacos", "celíacos",
  "sin fecula", "sin fécula", "feculas", "féculas", "fecula", "fécula",
  "ingredientes", "composicion", "composición", "que tiene", "qué tiene",
  "de que esta", "de qué está", "alérgenos", "alergenos", "conservantes",
  "100% carne", "100 por ciento carne",
];

function askingAboutIngredients(text: string): boolean {
  const q = normalize(text);
  return INGREDIENT_KEYWORDS.some((kw) => q.includes(normalize(kw)));
}

const AMBIGUOUS_B2B_PHRASES = [
  "sus productos en", "los productos en", "tus productos en",
  "productos en mi", "productos para mi",
];

function isAmbiguousB2BOrConsumer(text: string): boolean {
  const q = normalize(text);
  return AMBIGUOUS_B2B_PHRASES.some((p) => q.includes(normalize(p)));
}

// ---------------------------------------------------------------------------
// Consumer location flow helpers
// ---------------------------------------------------------------------------
async function sendStoresByBarrio(senderId: string, locationName: string, stores: ReturnType<typeof findByBarrioOnly>): Promise<void> {
  resetConfusion(senderId);
  await sendInstagramReply({
    recipientId: senderId,
    text: RESPONSES.consumer.storeFound(locationName, stores),
  });
}

async function triggerConfusionIfNeeded(senderId: string): Promise<boolean> {
  const count = incrementConfusion(senderId);
  if (count >= 2) {
    setSession(senderId, { segment: "confusion", step: "asking" });
    await sendInstagramReply({ recipientId: senderId, text: RESPONSES.confusion.escapeValve() });
    return true;
  }
  return false;
}

async function sendAllForCity(senderId: string, cityName: string): Promise<void> {
  const all = getAllForCity(cityName);
  if (all.length === 0) {
    const triggered = await triggerConfusionIfNeeded(senderId);
    if (!triggered) {
      const tiendaOnline = getOnlineStoreUrl();
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.noStore(tiendaOnline) });
    }
    return;
  }
  if (hasDistinctBarrios(all)) {
    const groups = groupByBarrio(all);
    await sendInstagramReply({
      recipientId: senderId,
      text: RESPONSES.consumer.storeFoundGrouped(cityName, groups),
    });
  } else {
    await sendInstagramReply({
      recipientId: senderId,
      text: RESPONSES.consumer.storeFound(cityName, all),
    });
  }
}

// ---------------------------------------------------------------------------
// Main message handler
// ---------------------------------------------------------------------------
async function handleMessage(senderId: string, text: string): Promise<void> {
  // Human-like typing delay (3–7 s)
  await new Promise<void>((resolve) => setTimeout(resolve, 3000 + Math.floor(Math.random() * 4000)));

  const session = getSession(senderId);

  // Identity guard: deflect questions about AI/technology regardless of session
  if (askingAboutAI(text)) {
    await sendInstagramReply({ recipientId: senderId, text: RESPONSES.identityGuard() });
    return;
  }

  // First-message: analyze intent + location before responding
  if (session.segment === "unknown") {
    const firstSegment = classifyMessage(text);

    if (firstSegment === "b2b") {
      const cityFromMessage = findByCityOnly(text)[0]?.ciudad ?? findKnownArgentineLocation(text) ?? undefined;
      setSession(senderId, { segment: "b2b", step: "collecting", city: cityFromMessage });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.b2b.askForData(cityFromMessage) });
      return;
    }
    if (firstSegment === "servicios_externos") {
      setSession(senderId, { segment: "vendedor" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.serviciosExternos.redirect() });
      return;
    }
    if (firstSegment === "vendedor") {
      setSession(senderId, { segment: "vendedor" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.vendedor.redirect() });
      return;
    }
    if (firstSegment === "queja") {
      setSession(senderId, { segment: "queja", step: "collecting" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.queja.askForData() });
      return;
    }
    if (firstSegment === "evento") {
      setSession(senderId, { segment: "evento", step: "confirming" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.evento.confirmInterest() });
      return;
    }

    // Consumer: try to extract location from first message
    if (firstSegment === "consumer") {
      if (askingAboutIngredients(text)) {
        setSession(senderId, { segment: "consumer" });
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.productInfo() });
        return;
      }
      if (askingAboutWhatsAppOrShipping(text)) {
        setSession(senderId, { segment: "consumer" });
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.whatsappPolicy() });
        return;
      }
      if (askingAboutPrice(text)) {
        setSession(senderId, { segment: "consumer" });
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.pricePolicy() });
        return;
      }
      const byBarrioFirst = findByBarrioOnly(text);
      if (byBarrioFirst.length > 0) {
        const cities = getBarrioCities(text);
        if (cities.length > 1) {
          const barrioName = byBarrioFirst[0]?.barrio ?? text;
          setSession(senderId, { segment: "consumer", step: "asking_city_for_barrio", barrio: barrioName });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askCityForBarrio(barrioName, cities) });
        } else {
          setSession(senderId, { segment: "consumer" });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.greetWithStores(byBarrioFirst[0]?.barrio ?? text, byBarrioFirst) });
        }
        return;
      }
      const byCityFirst = findByCityOnly(text);
      if (byCityFirst.length > 0) {
        const cityName = byCityFirst[0]!.ciudad;
        if (hasDistinctBarrios(byCityFirst)) {
          setSession(senderId, { segment: "consumer", step: "asking_barrio", city: cityName });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.greetWithAskBarrio(cityName) });
        } else {
          setSession(senderId, { segment: "consumer" });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.greetWithStores(cityName, byCityFirst) });
        }
        return;
      }
      const gbaLocFirst = findGBANorte(text);
      if (gbaLocFirst) {
        await sendGBANorteReply(senderId, gbaLocFirst.name, gbaLocFirst.mappedCity);
        return;
      }
      const knownLocFirst = findKnownArgentineLocation(text);
      if (knownLocFirst) {
        setSession(senderId, { segment: "evento", step: "confirming" });
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.noStoreInProvince(knownLocFirst) });
        return;
      }
    }

    // Default: generic greeting for unclear first messages
    setSession(senderId, { segment: "consumer" });
    await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.neutralGreeting() });
    return;
  }

  // Ingredient/technical product questions — answer regardless of session
  if (askingAboutIngredients(text)) {
    await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.productInfo() });
    return;
  }

  // Price policy: intercept price questions for consumer sessions
  if (session.segment === "consumer" && askingAboutPrice(text)) {
    await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.pricePolicy() });
    return;
  }

  // B2B data collection
  if (session.segment === "b2b" && session.step === "collecting") {
    const contacto = extractField(text, "nombre") ?? extractField(text, "nombre de contacto") ?? extractField(text, "contacto") ?? "Usuario de Instagram";
    const negocio = extractField(text, "negocio") ?? extractField(text, "nombre de tu negocio") ?? extractField(text, "local") ?? extractField(text, "empresa") ?? "Negocio sin nombre";
    const ciudad = extractField(text, "ciudad") ?? extractField(text, "ubicación") ?? extractField(text, "ubicacion") ?? extractField(text, "barrio") ?? session.city ?? "no informada";
    const whatsapp = extractField(text, "whatsapp") ?? extractField(text, "wp") ?? extractField(text, "wsp") ?? extractPhone(text) ?? "no informado";

    setSession(senderId, { segment: "b2b", step: "done" });
    const [, username_b2b] = await Promise.all([
      sendInstagramReply({ recipientId: senderId, text: RESPONSES.b2b.confirmation(negocio) }),
      fetchInstagramUsername(senderId),
    ]);
    await sendTelegramNotification({ segment: "b2b", contacto, negocio, ciudad, whatsapp, senderId, username: username_b2b });
    return;
  }

  // Evento: esperando confirmación de interés
  if (session.segment === "evento" && session.step === "confirming") {
    const q = normalize(text);
    const yes = ["si", "sí", "dale", "claro", "ok", "bueno", "porfa", "quiero", "me interesa", "genial"].some((w) => q.includes(w));
    if (yes) {
      setSession(senderId, { segment: "evento", step: "collecting" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.evento.askForData() });
    } else {
      setSession(senderId, { segment: "unknown" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.confusion.decline() });
    }
    return;
  }

  // Evento data collection
  if (session.segment === "evento" && session.step === "collecting") {
    const nombre = extractField(text, "nombre") ?? "Usuario de Instagram";
    const whatsapp = extractField(text, "whatsapp") ?? extractField(text, "wp") ?? extractField(text, "wsp") ?? extractPhone(text) ?? "no informado";
    const localidad = extractField(text, "localidad") ?? extractField(text, "ciudad") ?? extractField(text, "ubicación") ?? extractField(text, "ubicacion") ?? "no informada";
    const cantidad = extractField(text, "cantidad") ?? extractField(text, "kg") ?? extractField(text, "kilo") ?? "no informada";

    setSession(senderId, { segment: "evento", step: "done" });
    const [, username_evento] = await Promise.all([
      sendInstagramReply({ recipientId: senderId, text: RESPONSES.evento.confirmation(nombre) }),
      fetchInstagramUsername(senderId),
    ]);
    await sendTelegramNotification({ segment: "evento", nombre, localidad, cantidad, whatsapp, senderId, username: username_evento });
    return;
  }

  // Queja data collection
  if (session.segment === "queja" && session.step === "collecting") {
    const nombre = extractField(text, "nombre") ?? "Usuario de Instagram";
    const whatsapp = extractField(text, "whatsapp") ?? extractField(text, "wp") ?? extractField(text, "wsp") ?? extractPhone(text) ?? "no informado";
    const descripcion = text.slice(0, 300);

    setSession(senderId, { segment: "queja", step: "done" });
    const [, username_queja] = await Promise.all([
      sendInstagramReply({ recipientId: senderId, text: RESPONSES.queja.confirmation(nombre) }),
      fetchInstagramUsername(senderId),
    ]);
    await sendTelegramNotification({ segment: "queja", nombre, whatsapp, descripcion, senderId, username: username_queja });
    return;
  }

  // Confusion: waiting for yes/no on escape valve
  if (session.segment === "confusion" && session.step === "asking") {
    const q = normalize(text);
    const yes = ["si", "sí", "dale", "claro", "ok", "bueno", "porfa", "quiero", "genial"].some((w) => q.includes(w));
    const no = ["no", "gracias no", "no gracias", "dejá", "deja"].some((w) => q === w || q.startsWith(w + " "));
    if (no) {
      setSession(senderId, { segment: "unknown" });
      resetConfusion(senderId);
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.confusion.decline() });
    } else if (yes || (!no)) {
      setSession(senderId, { segment: "confusion", step: "collecting" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.confusion.askForData() });
    }
    return;
  }

  // Confusion: collecting lead data
  if (session.segment === "confusion" && session.step === "collecting") {
    const nombre = extractField(text, "nombre") ?? "Usuario de Instagram";
    const whatsapp = extractField(text, "whatsapp") ?? extractField(text, "wp") ?? extractField(text, "wsp") ?? extractPhone(text) ?? "no informado";
    const consulta = text.slice(0, 300);

    setSession(senderId, { segment: "confusion", step: "done" });
    resetConfusion(senderId);
    const [, username_confusion] = await Promise.all([
      sendInstagramReply({ recipientId: senderId, text: RESPONSES.confusion.confirmation() }),
      fetchInstagramUsername(senderId),
    ]);
    await sendTelegramNotification({ segment: "confusion", nombre, whatsapp, consulta, senderId, username: username_confusion });
    return;
  }

  // Consumer: disambiguating B2B vs consumer intent
  if (session.segment === "consumer" && "step" in session && session.step === "disambiguating_b2b") {
    const q = normalize(text);
    const wantsSell = ["vender", "revender", "distribuir", "negocio", "local", "venta", "si", "sí", "dale", "claro"].some((w) => q.includes(w));
    if (wantsSell) {
      setSession(senderId, { segment: "b2b", step: "collecting" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.b2b.askForData() });
    } else {
      setSession(senderId, { segment: "consumer", step: "asking_city" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askCityAfterGreeting() });
    }
    return;
  }

  // Consumer: disambiguating barrio city (e.g. "Centro de BA o Córdoba?")
  if (session.segment === "consumer" && "step" in session && session.step === "asking_city_for_barrio") {
    const savedBarrio = session.barrio;
    const byCity = findByCityOnly(text);
    setSession(senderId, { segment: "consumer" });
    if (byCity.length > 0) {
      const cityName = byCity[0]!.ciudad;
      const filtered = findByBarrioOnly(savedBarrio, cityName);
      if (filtered.length > 0) {
        await sendStoresByBarrio(senderId, savedBarrio, filtered);
      } else {
        await sendAllForCity(senderId, cityName);
      }
    } else {
      // Can't determine city — show all matches for that barrio
      const all = findByBarrioOnly(savedBarrio);
      await sendStoresByBarrio(senderId, savedBarrio, all);
    }
    return;
  }

  // Consumer: waiting for barrio refinement after showing big city — filter by saved city
  if (session.segment === "consumer" && "step" in session && session.step === "asking_barrio") {
    const savedCity = session.city;
    const byBarrio = findByBarrioOnly(text, savedCity);
    if (byBarrio.length > 0) {
      setSession(senderId, { segment: "consumer" });
      const barrio = byBarrio[0]?.barrio ?? text;
      await sendStoresByBarrio(senderId, barrio, byBarrio);
    } else {
      // User didn't specify barrio or repeated the city → show all grouped
      setSession(senderId, { segment: "consumer" });
      await sendAllForCity(senderId, savedCity);
    }
    return;
  }

  // Consumer: waiting for city/barrio (initial ask)
  if (session.segment === "consumer" && "step" in session && session.step === "asking_city") {
    const byBarrio = findByBarrioOnly(text);
    if (byBarrio.length > 0) {
      const cities = getBarrioCities(text);
      if (cities.length > 1) {
        const barrioName = byBarrio[0]?.barrio ?? text;
        setSession(senderId, { segment: "consumer", step: "asking_city_for_barrio", barrio: barrioName });
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askCityForBarrio(barrioName, cities) });
        return;
      }
      setSession(senderId, { segment: "consumer" });
      const barrio = byBarrio[0]?.barrio ?? text;
      await sendStoresByBarrio(senderId, barrio, byBarrio);
      return;
    }

    const byCity = findByCityOnly(text);
    if (byCity.length > 0) {
      const cityName = byCity[0]!.ciudad;
      if (hasDistinctBarrios(byCity)) {
        setSession(senderId, { segment: "consumer", step: "asking_barrio", city: cityName });
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askBarrio(cityName) });
      } else {
        setSession(senderId, { segment: "consumer" });
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.storeFound(cityName, byCity) });
      }
      return;
    }

    // Verificar si es una localidad del GBA Norte → redirigir a tienda más cercana
    const gbaLoc = findGBANorte(text);
    if (gbaLoc) {
      await sendGBANorteReply(senderId, gbaLoc.name, gbaLoc.mappedCity);
      return;
    }

    // Verificar si es una provincia/ciudad argentina conocida sin locales
    const knownLocation = findKnownArgentineLocation(text);
    if (knownLocation) {
      setSession(senderId, { segment: "evento", step: "confirming" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.noStoreInProvince(knownLocation) });
      return;
    }

    // Location not recognized — re-ask without diagnosing "no stores in your area" (no zone given yet)
    const triggered = await triggerConfusionIfNeeded(senderId);
    if (!triggered) {
      // Keep session at asking_city so the next reply is still treated as a location attempt
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askCityNotFound() });
    }
    return;
  }

  // New message — classify fresh
  const segment = classifyMessage(text);

  switch (segment) {
    case "consumer": {
      // Off-topic / low-intent / troll detection
      if (isOffTopic(text)) {
        const trollCount = incrementTroll(senderId);
        const response = trollCount >= 2
          ? RESPONSES.offTopic.naturalClose()
          : RESPONSES.offTopic.lightHumor();
        await sendInstagramReply({ recipientId: senderId, text: response });
        break;
      }
      resetTroll(senderId);

      // Check if barrio is in the message
      const byBarrio = findByBarrioOnly(text);
      if (byBarrio.length > 0) {
        const cities = getBarrioCities(text);
        if (cities.length > 1) {
          // Ambiguous barrio — ask which city
          const barrioName = byBarrio[0]?.barrio ?? text;
          setSession(senderId, { segment: "consumer", step: "asking_city_for_barrio", barrio: barrioName });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askCityForBarrio(barrioName, cities) });
          break;
        }
        setSession(senderId, { segment: "consumer" });
        const barrio = byBarrio[0]?.barrio ?? text;
        await sendStoresByBarrio(senderId, barrio, byBarrio);
        break;
      }
      // Check if city is in the message
      const byCity = findByCityOnly(text);
      if (byCity.length > 0) {
        const cityName = byCity[0]!.ciudad;
        if (hasDistinctBarrios(byCity)) {
          setSession(senderId, { segment: "consumer", step: "asking_barrio", city: cityName });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askBarrio(cityName) });
        } else {
          setSession(senderId, { segment: "consumer" });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.storeFound(cityName, byCity) });
        }
        break;
      }
      // GBA Norte location — redirect to nearest store
      const gbaLocConsumer = findGBANorte(text);
      if (gbaLocConsumer) {
        await sendGBANorteReply(senderId, gbaLocConsumer.name, gbaLocConsumer.mappedCity);
        break;
      }

      // No location in message — determine correct response (session is always consumer here, never unknown)
      if (isAmbiguous(text)) {
        // Mensaje sin sentido claro — pedir clarificación sin asumir intención de compra
        await sendInstagramReply({ recipientId: senderId, text: RESPONSES.clarification() });
      } else {
        const knownLocation = findKnownArgentineLocation(text);
        if (knownLocation) {
          // Provincia/ciudad sin locales — ofrecer envío desde fábrica sin pedir barrio
          setSession(senderId, { segment: "evento", step: "confirming" });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.noStoreInProvince(knownLocation) });
        } else if (mentionsProduct(text)) {
          // Mencionó un producto específico (ya saludamos)
          setSession(senderId, { segment: "consumer", step: "asking_city" });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askCityForProduct() });
        } else if (askingWhereToBuy(text) || mentionsBarrioKeyword(text)) {
          // Preguntó dónde comprar o mencionó barrio (ya saludamos) — pedir ciudad
          setSession(senderId, { segment: "consumer", step: "asking_city" });
          const responseText = mentionsBarrioKeyword(text)
            ? RESPONSES.consumer.askCityForUnknownBarrio()
            : RESPONSES.consumer.askCityAfterGreeting();
          await sendInstagramReply({ recipientId: senderId, text: responseText });
        } else if (isAmbiguousB2BOrConsumer(text)) {
          // Podría ser B2B o consumidor final — preguntar antes de asumir
          setSession(senderId, { segment: "consumer", step: "disambiguating_b2b" });
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askB2BorConsumer() });
        } else if (askingAboutWhatsAppOrShipping(text)) {
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.whatsappPolicy() });
        } else {
          // Consulta sin intención de compra explícita — NO pedir ubicación todavía
          await sendInstagramReply({ recipientId: senderId, text: RESPONSES.consumer.askHowToHelp() });
        }
      }
      break;
    }
    case "b2b": {
      const cityFromMessage = findByCityOnly(text)[0]?.ciudad ?? findKnownArgentineLocation(text) ?? undefined;
      setSession(senderId, { segment: "b2b", step: "collecting", city: cityFromMessage });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.b2b.askForData(cityFromMessage) });
      break;
    }
    case "evento": {
      setSession(senderId, { segment: "evento", step: "confirming" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.evento.confirmInterest() });
      break;
    }
    case "queja": {
      setSession(senderId, { segment: "queja", step: "collecting" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.queja.askForData() });
      break;
    }
    case "vendedor": {
      setSession(senderId, { segment: "vendedor" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.vendedor.redirect() });
      break;
    }
    case "servicios_externos": {
      setSession(senderId, { segment: "vendedor" });
      await sendInstagramReply({ recipientId: senderId, text: RESPONSES.serviciosExternos.redirect() });
      break;
    }
  }
}

async function processWebhookPayload(rawBody: string): Promise<void> {
  let payload: InstagramWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as InstagramWebhookPayload;
  } catch {
    console.warn("[instagram] Payload no es JSON válido");
    return;
  }
  if (payload.object !== "instagram") return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === "comments") {
        processCommentChange(change.value as CommentChangeValue).catch((err) => {
          console.error("[instagram] Error procesando comentario:", err);
        });
      }
    }

    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id;
      const text = event.message?.text;
      if (!senderId || !text) continue;

      const ownPageId = process.env["INSTAGRAM_PAGE_ID"];

      // Mensaje enviado por la propia página → operador humano tomó el control
      if (ownPageId && senderId === ownPageId) {
        const clientId = event.recipient?.id;
        if (clientId && clientId !== ownPageId) {
          markAsHumanManaged(clientId);
          console.info(`[instagram] Chat con ${clientId} ahora en manos de un operador humano`);
        }
        continue;
      }

      // Chat bajo control humano → ignorar respuestas automáticas
      if (isHumanManaged(senderId)) {
        updateLastActivity(senderId);
        console.info(`[instagram] Chat con ${senderId} ignorado. Control en manos de un operador humano.`);
        continue;
      }

      // Registrar actividad del cliente
      updateLastActivity(senderId);

      const isModoStaffMessage = /^modo staff\s*/i.test(text.trimStart());
      if (isModoStaffMessage) {
        markAsStaff(senderId);
        console.info(`[instagram] Modo Staff activado para ${senderId}`);
      }

      const processedText = isModoStaffMessage
        ? text.trimStart().replace(/^modo staff\s*/i, "").trim() || text
        : text;

      if (!isStaff(senderId) && !isAllowedInTestMode(senderId, processedText)) {
        console.info(`[instagram] Mensaje de ${senderId} ignorado (filtro test mode)`);
        continue;
      }
      await handleMessage(senderId, processedText).catch(async (err) => {
        console.error(`[instagram] Error procesando mensaje de ${senderId}:`, err);
        await sendInstagramReply({
          recipientId: senderId,
          text: RESPONSES.fallback(),
        }).catch(() => {});
      });
    }
  }
}

export function createInstagramWebhookHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode");
      const token = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      const verifyToken = process.env["INSTAGRAM_VERIFY_TOKEN"];
      if (mode === "subscribe" && token && verifyToken && token === verifyToken && challenge) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end(challenge);
      } else {
        res.statusCode = 403;
        res.end("Forbidden");
      }
      return true;
    }

    if (req.method === "POST") {
      let rawBody = "";
      try {
        rawBody = await readBody(req);
      } catch (err) {
        console.error("[instagram] Error leyendo body del webhook:", err);
        res.statusCode = 200;
        res.end("EVENT_RECEIVED");
        return true;
      }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/plain");
      res.end("EVENT_RECEIVED");
      processWebhookPayload(rawBody).catch((err) => {
        console.error("[instagram] Error procesando payload:", err);
      });
      return true;
    }

    res.statusCode = 405;
    res.end("Method Not Allowed");
    return true;
  };
}
