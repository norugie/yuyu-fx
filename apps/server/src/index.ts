import { fileURLToPath } from "node:url";
import { createApp, createTradingServices } from "./app.js";
import { ConfigError, loadConfig, loadEnvFileIfPresent, type Config } from "./config.js";
import { createQuestradeClient } from "./data/questrade/client.js";
import { createDbTokenStore } from "./data/questrade/token-store.js";
import { startQuotePoller } from "./data/quote-poller.js";
import { checkConnection, createDatabase } from "./db/client.js";
import { consoleLogger } from "./log.js";
import { parseSecretsKey } from "./secrets.js";

// Load .env from the repo root with Node's built-in loader (no dotenv needed).
// Variables already set in the shell are not overwritten.
loadEnvFileIfPresent(fileURLToPath(new URL("../../../.env", import.meta.url)));

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

// Fail fast if Postgres is unreachable or the credentials are wrong.
// The pg error says what went wrong (e.g. auth failed) without the password.
const { db, pool } = createDatabase(config.DATABASE_URL);
try {
  await checkConnection(pool);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`Cannot connect to the database: ${reason}`);
  process.exit(1);
}

// Bind to loopback only while YuyuFX runs locally (ARCHITECTURE §9).
const HOST = "127.0.0.1";
// Questrade market data (read-only). Without a token it stays off and prices are typed in.
const questrade = createQuestradeClient({
  store: createDbTokenStore(db, parseSecretsKey(config.SECRETS_KEY)),
  envRefreshToken: config.QUESTRADE_REFRESH_TOKEN,
  log: consoleLogger,
});
const appDeps = { db, config, questrade };
const services = createTradingServices(appDeps);
startQuotePoller(db, services.prices, consoleLogger);

createApp(appDeps, services).listen(config.PORT, HOST, (error) => {
  if (error) {
    console.error(`Server failed to start on ${HOST}:${config.PORT}: ${error.message}`);
    process.exit(1);
  }
  console.log(`Server listening on http://${HOST}:${config.PORT}`);
});
