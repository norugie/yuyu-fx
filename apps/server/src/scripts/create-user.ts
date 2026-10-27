// `npm run user:create`: create a login for YuyuFX. There is no sign-up page.
// Interactive: asks for a username and the password twice (password is hidden).
// Non-interactive: reads three lines from stdin (username, password, password again).

import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { normalizeUsername, validateNewCredentials } from "../api/auth/credentials.js";
import { createUser, UserExistsError } from "../api/auth/users.js";
import { ConfigError, loadConfig, loadEnvFileIfPresent } from "../config.js";
import { createDatabase } from "../db/client.js";

/** Read a line from the terminal without echoing it. */
function promptHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  process.stdout.write(question);
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();

  return new Promise((resolve, reject) => {
    let input = "";
    const done = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          done();
          resolve(input);
          return;
        }
        if (char === "\u0003") {
          // Ctrl+C
          done();
          reject(new Error("Cancelled"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          input = input.slice(0, -1);
          continue;
        }
        input += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function readInteractive(): Promise<[string, string, string]> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const username = await rl.question("Username: ");
  rl.close();
  const password = await promptHidden("Password (hidden): ");
  const confirm = await promptHidden("Password again: ");
  return [username, password, confirm];
}

async function readPiped(): Promise<[string, string, string]> {
  const lines: string[] = [];
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    lines.push(line.replace(/\r$/, ""));
    if (lines.length === 3) break;
  }
  rl.close();
  return [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
}

async function main(): Promise<number> {
  loadEnvFileIfPresent(fileURLToPath(new URL("../../../../.env", import.meta.url)));
  const config = loadConfig(process.env);

  const [rawUsername, password, confirm] = process.stdin.isTTY
    ? await readInteractive()
    : await readPiped();

  const username = normalizeUsername(rawUsername);
  const problem = validateNewCredentials(username, password);
  if (problem) {
    console.error(problem);
    return 1;
  }
  if (password !== confirm) {
    console.error("Passwords do not match.");
    return 1;
  }

  const { db, pool } = createDatabase(config.DATABASE_URL);
  try {
    const user = await createUser(db, username, password);
    console.log(`Created user "${user.username}" (id ${user.id}).`);
    return 0;
  } catch (error) {
    if (error instanceof UserExistsError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof ConfigError ? error.message : `Failed: ${String(error)}`);
    process.exit(1);
  },
);
