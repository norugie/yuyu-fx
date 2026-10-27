// Trading mode shown on every screen (DESIGN.md: "Paper vs live is always obvious").
// Paper only for now; it will come from the server's settings once live mode exists (F8).
export type TradingMode = "paper" | "live";

export const CURRENT_MODE: TradingMode = "paper";
