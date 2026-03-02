/**
 * Configuration for download servers.
 * Stored in ~/.context/config.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ServerConfig {
  name: string;
  url: string;
  default?: boolean;
}

export interface Config {
  servers: ServerConfig[];
}

const CONFIG_DIR = join(homedir(), ".context");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  servers: [
    {
      name: "neuledge",
      url: "https://context.neuledge.com",
      default: true,
    },
  ],
};

/** Load config from disk, returning defaults if not found. */
export function loadConfig(): Config {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      return JSON.parse(raw) as Config;
    }
  } catch {
    // Fall through to defaults on parse error
  }
  return DEFAULT_CONFIG;
}

/** Save config to disk. */
export function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/** Get the default server URL. */
export function getDefaultServerUrl(): string {
  const config = loadConfig();
  const defaultServer = config.servers.find((s) => s.default);
  return defaultServer?.url ?? "https://context.neuledge.com";
}

/** Get a server URL by name, falling back to default. */
export function getServerUrl(name?: string): string {
  if (!name) return getDefaultServerUrl();

  const config = loadConfig();
  const server = config.servers.find((s) => s.name === name);
  if (!server) {
    throw new Error(
      `Server "${name}" not found. Available: ${config.servers.map((s) => s.name).join(", ")}`,
    );
  }
  return server.url;
}
