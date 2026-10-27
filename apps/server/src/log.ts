// Short, structured log lines (one JSON object per line) so login events can be
// searched later. Never pass passwords, tokens or secrets in `fields`.

export type LogFields = Record<string, string | number | boolean | undefined>;
export type Logger = (event: string, fields?: LogFields) => void;

export const consoleLogger: Logger = (event, fields = {}) => {
  console.log(JSON.stringify({ time: new Date().toISOString(), event, ...fields }));
};
