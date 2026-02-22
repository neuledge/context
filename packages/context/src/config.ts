/**
 * Server configuration for download servers.
 * Reads from ~/.context/config.json with a built-in default for Neuledge.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ServerConfig {
  name: string;
  url: string;
  default?: boolean;
}

export interface ContextConfig {
  servers: ServerConfig[];
}

const CONFIG_DIR = join(homedir(), ".context");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_SERVER: ServerConfig = {
  name: "neuledge",
  url: "https://context.neuledge.com",
  default: true,
};

/**
 * Read config from ~/.context/config.json.
 * Returns default config if file doesn't exist.
 */
export function readConfig(): ContextConfig {
  if (!existsSync(CONFIG_PATH)) {
    return { servers: [DEFAULT_SERVER] };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<ContextConfig>;
    if (!Array.isArray(parsed.servers) || parsed.servers.length === 0) {
      return { servers: [DEFAULT_SERVER] };
    }
    return parsed as ContextConfig;
  } catch {
    return { servers: [DEFAULT_SERVER] };
  }
}

/**
 * Get the default download server URL.
 */
export function getDefaultServerUrl(): string {
  const config = readConfig();
  const defaultServer =
    config.servers.find((s) => s.default) ?? config.servers[0];
  return defaultServer?.url ?? DEFAULT_SERVER.url;
}

/**
 * Get a server by name, or the default if name is not specified.
 */
export function getServerUrl(name?: string): string {
  if (!name) return getDefaultServerUrl();

  const config = readConfig();
  const server = config.servers.find((s) => s.name === name);
  if (!server) {
    throw new Error(
      `Unknown server: ${name}. Configure servers in ~/.context/config.json`,
    );
  }
  return server.url;
}
