import { handlers } from "@/auth";

export const { GET, POST } = handlers;

// The Argon2 binding and the Postgres driver are native modules.
export const runtime = "nodejs";
