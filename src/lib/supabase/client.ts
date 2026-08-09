"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseConfig } from "./config";
import type { Database } from "./database.types";

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null;

/** Returns null in demo/local builds where Supabase has not been configured. */
export function createSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;

  const config = getPublicSupabaseConfig();
  browserClient = config
    ? createBrowserClient<Database>(config.url, config.anonKey)
    : null;

  return browserClient;
}

