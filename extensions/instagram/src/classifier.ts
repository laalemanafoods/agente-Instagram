// Classifies incoming Instagram DM text into one of four segments for La Alemana Foods.

export type Segment = "consumer" | "b2b" | "evento" | "queja" | "vendedor" | "servicios_externos";

const B2B_KEYWORDS = [
  "fiambrería",
  "fiambreria",
  "fiambres",
  "restaurante",
  "restaurant",
  "gastronomía",
  "gastronomia",
  "gastro",
  "eventos",
  "mayorista",
  "por mayor",
  "negocio",
  "local comercial",
  "distribución",
  "distribucion",
  "distribuir",
  "distribuidor",
  "distribuidora",
  "proveedor",
  "almacén",
  "almacen",
  "supermercado",
  "buffet",
  "catering",
  "hotel",
  "confitería",
  "confiteria",
  "cantina",
  "parrilla",
  "precio comercial",
  "precio al por mayor",
  "precio mayorista",
  "lista de precios",
  "lista precio",
  "revender",
  "revendedor",
  "revendedora",
  "para mi negocio",
  "precios por cantidad",
  "quiero revender",
  "para el local",
  "quiero vender sus",
  "quiero vender los",
  "vender sus productos",
  "vender los productos",
  "vender en mi local",
  "vender en mi negocio",
  "les interesa vender en",
  "interesa vender en",
  "me interesa distribuir",
  "ser distribuidor",
  "ser distribuidora",
  "trabajar con ustedes",
  "trabajar juntos",
];

const SERVICIOS_EXTERNOS_KEYWORDS = [
  "ofrezco mis servicios",
  "ofrecemos servicios",
  "empresa de limpieza",
  "empresa de fletes",
  "servicio de fletes",
  "servicios de marketing",
  "servicios de diseño",
  "servicios de publicidad",
  "servicio de publicidad",
  "agencia de marketing",
  "agencia de publicidad",
  "agencia de diseño",
  "agencia de comunicación",
  "agencia de comunicacion",
  "somos una agencia",
  "soy diseñador",
  "soy diseñadora",
  "soy community manager",
  "community manager",
  "gestor de redes",
  "gestora de redes",
  "manejo redes",
  // Colaboraciones / partnerships / merchandising
  "merchandising",
  "merch oficial",
  "canje",
  "partnership",
  "propuesta de colaboración",
  "propuesta de colaboracion",
  "explorar una colaboración",
  "explorar una colaboracion",
  "hacer algo en conjunto",
  "trabajar juntos en",
  "generación de contenido",
  "generacion de contenido",
  "difusión en redes",
  "difusion en redes",
  "contenido y difusión",
  "contenido y difusion",
  "presencia dentro del evento",
  "coordinamos una charla",
  "coordinamos una reunión",
  "coordinamos una reunion",
  "compartir más info",
  "compartir mas info",
  "les puedo enviar info",
  "les puedo compartir",
  // Influencers / creadores de contenido
  "soy influencer",
  "soy creadora de contenido",
  "soy creador de contenido",
  "creadora de contenido",
  "creador de contenido",
  "tiktoker",
  "youtuber",
];

const QUEJA_KEYWORDS = [
  "queja",
  "reclamo",
  "problema",
  "inconveniente",
  "mal estado",
  "vencido",
  "vencida",
  "podrido",
  "podrida",
  "desagradable",
  "horrible",
  "pésimo",
  "pesimo",
  "no sirve",
  "defecto",
  "defectuoso",
  "dañado",
  "dañada",
  "en mal estado",
  "me hizo mal",
  "intoxicación",
  "intoxicacion",
  "devolución",
  "devolucion",
  "me enfermé",
  "me enferme",
  "está malo",
  "esta malo",
];

const EVENTO_KEYWORDS = [
  "cumpleaños", "cumpleanos", "casamiento", "boda", "bodas",
  "fiesta", "fiestas", "quince", "quinceañera", "quinceañero", "quinceañeras",
  "agasajo", "reunion familiar", "reunión familiar",
  "10 kg", "10kg", "20 kg", "20kg", "30 kg", "30kg",
  "mas de 10 kilo", "más de 10 kilo", "grandes cantidades", "gran cantidad",
  "muchos kilos", "varios kilos", "bastantes kilos",
];

const VENDEDOR_KEYWORDS = [
  "vendedor",
  "vendedora",
  "representante",
  "agente de ventas",
  "ser representante",
  "comisión de venta",
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function classifyMessage(text: string): Segment {
  const lower = normalize(text);

  if (SERVICIOS_EXTERNOS_KEYWORDS.some((kw) => lower.includes(normalize(kw)))) {
    return "servicios_externos";
  }
  // B2B must be checked before VENDEDOR: "quiero vender sus productos" is B2B, not a sales rep request
  if (B2B_KEYWORDS.some((kw) => lower.includes(normalize(kw)))) {
    return "b2b";
  }
  if (VENDEDOR_KEYWORDS.some((kw) => lower.includes(normalize(kw)))) {
    return "vendedor";
  }
  if (EVENTO_KEYWORDS.some((kw) => lower.includes(normalize(kw)))) {
    return "evento";
  }
  if (QUEJA_KEYWORDS.some((kw) => lower.includes(normalize(kw)))) {
    return "queja";
  }
  return "consumer";
}
