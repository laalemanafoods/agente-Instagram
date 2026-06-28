import type { PuntoDeVenta } from "./puntos-de-venta.js";

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function formatStore(s: PuntoDeVenta): string {
  const dir = s.direccion ? ` 📍 ${s.direccion}` : "";
  const handle = s.instagram ? ` ${s.instagram}` : "";
  return `• ${s.nombre}${dir}${handle}`;
}

export const RESPONSES = {
  consumer: {
    pricePolicy(): string {
      return "Los precios varían según cada punto de venta minorista, pero te ayudo a encontrar el local más cercano para que consultes ahí directamente. 😊 ¿En qué ciudad o barrio estás?";
    },

    neutralGreeting(): string {
      return pick([
        "¡Hola! Qué gusto saludarte. Soy La Alemanita Digital, la asistente de La Alemana Foods 😊 ¿En qué puedo ayudarte?",
        "¡Hola! Bienvenido/a. Soy La Alemanita Digital, la asistente de La Alemana Foods 🌭 ¿En qué te puedo ayudar hoy?",
        "¡Hola! Soy La Alemanita Digital de La Alemana Foods 😊 ¿Cómo te puedo ayudar?",
      ]);
    },

    askCity(): string {
      return "¡Claro! Decime en qué ciudad o barrio estás así te busco el local más cercano.";
    },

    askCityDirect(): string {
      return "¡Claro! Decime en qué ciudad o barrio estás así te busco el local más cercano.";
    },

    askCityAfterGreeting(): string {
      return "¡Claro! Decime en qué ciudad o barrio estás así te busco el local más cercano.";
    },

    askCityForProduct(): string {
      return "¡Excelente elección! 🌭 Para decirte cuál es el lugar más cercano, ¿en qué ciudad o barrio estás?";
    },

    askHowToHelp(): string {
      return pick([
        "Claro, estoy acá para ayudarte 🌭 ¿Buscás un punto de venta o tenés otra pregunta?",
        "¡Decime! 😊 ¿Te puedo orientar sobre dónde encontrar nuestros productos?",
        "Con gusto te ayudo. ¿Querés encontrar un local cercano o tenés alguna otra duda? 😊",
      ]);
    },

    whatsappPolicy(): string {
      return (
        "¿Cómo estás? Te cuento: las compras y envíos por WhatsApp los manejamos directo desde fábrica para pedidos grandes o eventos (+10 kg) 🍖\n\n" +
        "Si buscás una compra menor (de a paquetes), te ayudamos a encontrar el punto de venta más cercano a tu casa.\n\n" +
        "¿Cuál de las dos opciones se adapta mejor a lo que necesitás hoy? 😊"
      );
    },

    productInfo(): string {
      return (
        "¡Sí! Todos nuestros productos son 100% carne, sin gluten, sin TACC y sin féculas 🌿\n\n" +
        "• Bratwurst (para asar): Frankfurter, Thüringer, Salame y Queso, Rinderwurst (100% vaca) y Fleischkäse\n" +
        "• Knackwurst (para agua): Dicke Knackwurst, Wiener Wurst y Mini Wiener\n" +
        "• Untables: Leberwurst Premium con miel, Leberwurst Casero y Panceta ahumada\n\n" +
        "¿Querés saber dónde conseguirlos?"
      );
    },

    askB2BorConsumer(): string {
      return "¿Querés vender nuestros productos en tu negocio o estás buscando dónde comprarlos para probarlos? 😊";
    },

    noStoreInProvince(province: string): string {
      return (
        `¿Cómo estás? Lastimosamente no estamos todavía en ${province} con locales físicos. 🙌\n\n` +
        `Pero para que no te quedes con las ganas, podés hacer un pedido mayor (+10 kg) para stockear tu freezer o para un evento, y te lo enviamos directo desde nuestra fábrica.\n\n` +
        `¿Te interesa que te contemos cómo coordinar?`
      );
    },

    askCityNotFound(): string {
      return "No encontré esa ubicación. ¿En qué ciudad o barrio estás? 😊";
    },

    askCityForUnknownBarrio(): string {
      return "No encontré ese barrio en nuestra base. ¿En qué ciudad estás? Así te busco el local más cercano. 😊";
    },

    askCityForBarrio(barrioName: string, cities: string[]): string {
      if (cities.length === 2) {
        return `¿${barrioName} de ${cities[0]} o de ${cities[1]}? 😊`;
      }
      const last = cities[cities.length - 1]!;
      const rest = cities.slice(0, -1).join(", ");
      return `¿En qué ciudad estás: ${rest} o ${last}? 😊`;
    },

    askBarrio(cityName: string): string {
      return (
        `¡Qué bueno! En ${cityName} tenemos muchísimos puntos de venta 😊\n\n` +
        "¿En qué barrio o zona estás específicamente? Así te paso los que te queden más cómodos."
      );
    },

    greetWithStores(locationName: string, stores: PuntoDeVenta[]): string {
      const lines = stores.map(formatStore).join("\n");
      return `¡Hola! 🙌 En ${locationName} podés conseguir nuestros productos en:\n\n${lines}\n\n¿Necesitás algo más? 😊`;
    },

    greetWithStoresGrouped(locationName: string, groups: Map<string, PuntoDeVenta[]>): string {
      const body = Array.from(groups.entries())
        .map(([barrio, stores]) => {
          const lines = stores.map(formatStore).join("\n");
          return `${barrio.toUpperCase()}\n${lines}`;
        })
        .join("\n\n");
      return `¡Hola! 🙌 En ${locationName} tenemos varios puntos de venta:\n\n${body}\n\n¿Necesitás algo más? 😊`;
    },

    greetWithAskBarrio(cityName: string): string {
      return `¡Claro! 😊 ¿En qué barrio o zona de ${cityName} estás? Así te recomiendo el punto de venta más cercano.`;
    },

    storeFound(locationName: string, stores: PuntoDeVenta[]): string {
      const lines = stores.map(formatStore).join("\n");
      return `¡Claro! Te cuento dónde podés encontrar nuestros productos en ${locationName}:\n\n${lines}\n\n¿Necesitás algo más? 😊`;
    },

    storeFoundNearby(locationName: string, stores: PuntoDeVenta[]): string {
      if (stores.length === 0) {
        return `Disculpame, se me complicó buscar esa zona. 😅 ¿Me podés decir otra localidad o barrio cercano para guiarte mejor?`;
      }
      const nearbyCity = stores[0]!.ciudad;
      const lines = stores.map(formatStore).join("\n");
      return (
        `¿Cómo estás? En ${locationName} no tenemos local propio, pero el más cercano lo tenés en ${nearbyCity}:\n\n` +
        `${lines}\n\n` +
        `¿Te queda cómodo este punto? 😊`
      );
    },

    storeFoundNearbyGrouped(locationName: string, nearbyCity: string, groups: Map<string, PuntoDeVenta[]>): string {
      if (groups.size === 0) {
        return `Disculpame, se me complicó buscar esa zona. 😅 ¿Me podés decir otra localidad o barrio cercano para guiarte mejor?`;
      }
      const body = Array.from(groups.entries())
        .map(([barrio, stores]) => {
          const lines = stores.map(formatStore).join("\n");
          return `${barrio.toUpperCase()}\n${lines}`;
        })
        .join("\n\n");
      return (
        `¿Cómo estás? En ${locationName} no tenemos local propio, pero los más cercanos los tenés en ${nearbyCity}:\n\n` +
        `${body}\n\n` +
        `¿Cuál te queda más cómodo? 😊`
      );
    },

    storeFoundGrouped(locationName: string, groups: Map<string, PuntoDeVenta[]>): string {
      const body = Array.from(groups.entries())
        .map(([barrio, stores]) => {
          const lines = stores.map(formatStore).join("\n");
          return `${barrio.toUpperCase()}\n${lines}`;
        })
        .join("\n\n");
      return `¡Claro! Te cuento dónde podés encontrar nuestros productos en ${locationName}:\n\n${body}\n\n¿Necesitás algo más? 😊`;
    },

    noStore(tiendaOnline: string): string {
      const link = tiendaOnline
        ? `Podés comprarnos online acá: ${tiendaOnline}`
        : "Consultame y veo cómo ayudarte.";
      return `Por ahora no tenemos un punto de venta en tu zona 😊 ${link}\n\n¿Te puedo ayudar con algo más?`;
    },
  },

  b2b: {
    askForData(city?: string): string {
      const greeting = city
        ? `¡Qué bueno que te interese trabajar con nosotros en ${city}! 🙌 Para que el equipo comercial te contacte con la info mayorista, por favor pasame:\n\n`
        : `¡Qué bueno que te interese trabajar con nosotros! 🙌 Para que el equipo comercial te contacte con la info mayorista, por favor pasame:\n\n`;
      return (
        greeting +
        "• Nombre:\n" +
        "• WhatsApp:\n" +
        "• Nombre de tu negocio:\n" +
        (city ? "" : "• Ciudad:\n") +
        "\n¿Me los pasás?"
      );
    },

    confirmation(_negocio: string): string {
      return "¡Excelente! Ya envié tus datos al sector de ventas. Se van a estar comunicando con vos por teléfono a la brevedad. 😊\n\n¿Hay algo más en lo que te pueda ayudar?";
    },
  },

  evento: {
    confirmInterest(): string {
      return "¡Claro! Para compras grandes (+10 kg) podemos enviarte desde fábrica. ¿Te interesa?";
    },

    askForData(): string {
      return (
        "¡Perfecto! Necesito estos datos para organizarlo:\n\n" +
        "• Tu nombre:\n" +
        "• WhatsApp:\n" +
        "• Localidad:\n" +
        "• Cantidad estimada (kg):\n\n" +
        "El equipo te confirma todo a la brevedad."
      );
    },

    confirmation(_nombre: string): string {
      return "¡Excelente! Ya envié tus datos al sector de ventas. Se van a estar comunicando con vos por teléfono a la brevedad. 😊";
    },
  },

  queja: {
    askForData(): string {
      return (
        "Lo sentimos mucho, eso no debería pasar 😟\n\n" +
        "Para darte el mejor seguimiento, necesito:\n\n" +
        "• Tu nombre:\n" +
        "• WhatsApp:\n" +
        "• Descripción breve del problema:\n\n" +
        "El equipo te va a contactar a la brevedad."
      );
    },

    confirmation(nombre: string): string {
      return (
        `Gracias ${nombre}, ya le avisé al equipo 🙌\n\n` +
        "Te van a contactar a la brevedad por WhatsApp. ¿Hay algo más en lo que te pueda ayudar?"
      );
    },
  },

  vendedor: {
    redirect(): string {
      return (
        "¡Qué bueno que te interese sumarte! Mandanos tus datos a laalemanafoods@gmail.com y el equipo comercial te responde pronto 📧\n\n" +
        "¿Hay algo más en lo que te pueda ayudar?"
      );
    },
  },

  confusion: {
    escapeValve(): string {
      return "Veo que tenés dudas muy específicas y no quiero darte información errónea. 😊 ¿Te gustaría que un asesor del sector de ventas se comunique con vos para asesorarte personalmente?";
    },

    askForData(): string {
      return (
        "¡Perfecto! Para que te contacten, necesito:\n\n" +
        "• Tu nombre:\n" +
        "• WhatsApp:\n" +
        "• Tema de tu consulta:"
      );
    },

    confirmation(): string {
      return "¡Excelente! Ya envié tus datos al sector de ventas. Se van a estar comunicando con vos por teléfono a la brevedad. 😊";
    },

    decline(): string {
      return "¡Perfecto! Estoy acá si necesitás algo más. 😊";
    },
  },

  serviciosExternos: {
    redirect(): string {
      return (
        "¡Muchas gracias por pensar en nosotros! 😊 Por favor mandá toda la información sobre tu propuesta, productos o servicios a laalemanafoods@gmail.com y el equipo te va a responder a la brevedad."
      );
    },
  },

  offTopic: {
    lightHumor(): string {
      return pick([
        "😄 Esa consulta se nos fue un poco del menú.",
        "🌭 Por ahora solo trabajamos con productos gastronómicos, ¡pero se agradece la creatividad!",
        "😄 Todavía no llegamos tan lejos jaja. ¿Puedo ayudarte con algo de La Alemana?",
        "🌭 Eso está fuera de nuestra carta por ahora.",
      ]);
    },
    naturalClose(): string {
      return pick([
        "🌭 Cuando quieras hablar de salchichas alemanas, acá estoy.",
        "🙌 Si necesitás info real sobre nuestros productos, feliz de ayudarte.",
        "😄 Creo que nos fuimos un poco del menú. ¡Cuando quieras seguimos!",
      ]);
    },
  },

  identityGuard(): string {
    return "Soy la asistente de La Alemana Foods 😊 No puedo compartir detalles técnicos, pero sí ayudarte con nuestros productos.";
  },

  clarification(): string {
    return pick([
      "Perdón, no terminé de entender tu consulta. 🤭 ¿Podrías explicármelo de otra forma?",
      "Hmm, no logro entender bien. ¿Me lo contás de otra manera? 😊",
      "No llegué a entender bien eso. ¿Me das más detalle? 😊",
    ]);
  },

  fallback(): string {
    return "¡Hola! Soy La Alemanita Digital 🌭 ¿En qué puedo ayudarte hoy?";
  },
};
