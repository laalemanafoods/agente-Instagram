import { definePluginEntry, type OpenClawPluginApi } from "./api.js";
import { createInstagramWebhookHandler } from "./src/handler.js";

const DEFAULT_WEBHOOK_PATH = "/plugins/instagram/webhook";

// Variables de entorno requeridas para el funcionamiento completo del plugin.
const REQUIRED_ENV_VARS = [
  "INSTAGRAM_ACCESS_TOKEN",
  "INSTAGRAM_PAGE_ID",
  "INSTAGRAM_VERIFY_TOKEN",
  "IG_TELEGRAM_BOT_TOKEN",
  "IG_TELEGRAM_CHAT_ID",
] as const;

// Variables de modo test (opcionales, activas por defecto).
const TEST_ENV_VARS = [
  "INSTAGRAM_TEST_MODE",     // 'true' (default) | 'false' para producción
  "INSTAGRAM_TEST_SENDER_ID", // PSID del usuario nikigummlich
] as const;

function validateEnvVars(api: OpenClawPluginApi): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]?.trim());
  if (missing.length > 0) {
    api.logger.warn?.(
      `[instagram] Variables de entorno faltantes: ${missing.join(", ")}. ` +
        "El plugin puede no funcionar correctamente.",
    );
  }

  const testMode = process.env["INSTAGRAM_TEST_MODE"];
  const isTestMode = !testMode || (testMode !== "false" && testMode !== "0");
  if (isTestMode) {
    const hasSenderId = Boolean(process.env["INSTAGRAM_TEST_SENDER_ID"]?.trim());
    api.logger.info?.(
      `[instagram] Modo test ACTIVO. ` +
        `Responde a: ACTIVAR_TEST en el mensaje` +
        (hasSenderId ? " | remitente autorizado configurado" : " | INSTAGRAM_TEST_SENDER_ID no configurado"),
    );
  }
}

export default definePluginEntry({
  id: "instagram",
  name: "Instagram DM Router",
  description:
    "Clasifica mensajes de Instagram en segmentos B2B, Consumidor, Quejas y Vendedores. " +
    "Envía notificaciones a Telegram para leads B2B y quejas. Filtro de seguridad por modo test.",
  register(api: OpenClawPluginApi) {
    const pluginConfig = api.pluginConfig as { webhookPath?: string } | undefined;
    const webhookPath = pluginConfig?.webhookPath?.trim() || DEFAULT_WEBHOOK_PATH;

    const handler = createInstagramWebhookHandler();

    api.registerHttpRoute({
      path: webhookPath,
      auth: "plugin",
      match: "exact",
      replaceExisting: true,
      handler,
    });

    validateEnvVars(api);

    api.logger.info?.(
      `[instagram] Webhook registrado en ${webhookPath}. ` +
        `Variables: ${[...REQUIRED_ENV_VARS, ...TEST_ENV_VARS].join(", ")}`,
    );
  },
});
