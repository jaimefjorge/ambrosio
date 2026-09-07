import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type RepoConfig = { name: string; path: string; prefix: string };
export type Hours = { planning: string; digestFrom: string; digestTo: string; wrapUp: string };

export type AmbrosioConfig = {
  repos: RepoConfig[];
  wipLimit: number;
  turnCap: number;
  hours: Hours;
  imessage: { handle: string };
  urgentPatterns: string[];
  homeDir: string;
  rootDir: string;
  /** Configured repos whose path is absent on this machine. Empty unless loaded leniently. */
  missingRepos: RepoConfig[];
};

export class ConfigError extends Error {}

/** Expand a leading ~ so configs stay portable between machines. */
export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return resolve(p);
}

const DEFAULT_HOURS: Hours = { planning: "09:00", digestFrom: "09:00", digestTo: "14:00", wrapUp: "15:00" };

/** Root of the Ambrosio checkout: two levels up from this file (src/ -> repo). */
export function rootDir(): string {
  return resolve(new URL("..", import.meta.url).pathname);
}

export function homeDir(): string {
  return process.env.AMBROSIO_HOME ?? join(homedir(), ".ambrosio");
}

export type LoadOptions = {
  /** Report missing repos on the result instead of throwing. Used by `setup`, which exists to fix them. */
  lenient?: boolean;
};

export function loadConfig(path?: string, opts: LoadOptions = {}): AmbrosioConfig {
  const root = rootDir();
  const file = path ?? process.env.AMBROSIO_CONFIG ?? join(root, "ambrosio.config.json");
  if (!existsSync(file)) throw new ConfigError(`config not found: ${file}`);

  let raw: any;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`config is not valid JSON: ${file}: ${(e as Error).message}`);
  }

  if (!Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new ConfigError("config.repos must be a non-empty array");
  }
  const repos: RepoConfig[] = raw.repos.map((r: any) => {
    if (!r?.name || !r?.path || !r?.prefix) {
      throw new ConfigError(`each repo needs name, path and prefix: ${JSON.stringify(r)}`);
    }
    return { name: r.name, path: expandHome(r.path), prefix: r.prefix };
  });

  const missing = repos.filter((r) => !existsSync(r.path));
  if (missing.length > 0 && !opts.lenient && !process.env.AMBROSIO_SKIP_REPO_CHECK) {
    throw new ConfigError(
      `these repos in ambrosio.config.json do not exist on this machine:\n` +
        missing.map((r) => `  ${r.name} -> ${r.path}`).join("\n") +
        `\nClone them there, or edit ambrosio.config.json to match this machine, then run: bin/ambrosio setup`,
    );
  }

  return {
    repos,
    wipLimit: raw.wipLimit ?? 3,
    turnCap: raw.turnCap ?? 150,
    hours: { ...DEFAULT_HOURS, ...(raw.hours ?? {}) },
    imessage: { handle: raw.imessage?.handle ?? "" },
    urgentPatterns: raw.urgentPatterns ?? [],
    homeDir: homeDir(),
    rootDir: root,
    missingRepos: missing,
  };
}

export function repoByName(cfg: AmbrosioConfig, name: string): RepoConfig {
  const r = cfg.repos.find((x) => x.name === name || x.prefix === name);
  if (!r) throw new ConfigError(`unknown repo: ${name}. Known: ${cfg.repos.map((x) => x.name).join(", ")}`);
  return r;
}

/** "HH:MM" -> minutes since midnight. */
export function hhmm(v: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) throw new ConfigError(`bad time: ${v}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function withinHours(cfg: AmbrosioConfig, now = new Date()): boolean {
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= hhmm(cfg.hours.digestFrom) && mins <= hhmm(cfg.hours.wrapUp);
}
