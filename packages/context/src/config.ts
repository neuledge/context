/**
 * Server configuration for download servers.
 * Stored in ~/.context/config.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ServerConfig {
  name: string;
  url: string;
  default?: boolean;
}

interface Config {
  servers: ServerConfig[];
}

const DEFAULT_SERVER: ServerConfig = {
  name: "neuledge",
  url: "https://context.neuledge.com",
  default: true,
};

const CONFIG_PATH = join(homedir(), ".context", "config.json");

function readConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    return { servers: [DEFAULT_SERVER] };
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as Config;
  } catch {
    return { servers: [DEFAULT_SERVER] };
  }
}

function writeConfig(config: Config): void {
  const dir = dirname(CONFIG_PATH);
  mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function getServers(): ServerConfig[] {
  return readConfig().servers;
}

export function getDefaultServer(): ServerConfig {
  const config = readConfig();
  return (
    config.servers.find((s) => s.default) ?? config.servers[0] ?? DEFAULT_SERVER
  );
}

export function addServer(server: ServerConfig): void {
  const config = readConfig();

  // If this is the new default, unset others
  if (server.default) {
    for (const s of config.servers) {
      s.default = false;
    }
  }

  const existing = config.servers.findIndex((s) => s.name === server.name);
  if (existing >= 0) {
    config.servers[existing] = server;
  } else {
    config.servers.push(server);
  }

  writeConfig(config);
}

export function removeServer(name: string): boolean {
  const config = readConfig();
  const idx = config.servers.findIndex((s) => s.name === name);
  if (idx < 0) return false;

  config.servers.splice(idx, 1);
  writeConfig(config);
  return true;
}
