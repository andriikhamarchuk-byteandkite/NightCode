import { resolve, relative, isAbsolute, sep, basename } from "path";

// Returns the absolute path if it stays inside cwd, otherwise null.
// Uses relative() instead of startsWith() so "/proj-secrets" is not treated
// as inside "/proj", and so Windows drive-letter casing is handled.
export function resolveInsideCwd(cwd: string, path: string): string | null {
  const resolved = resolve(cwd, path);
  const rel = relative(cwd, resolved);

  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return null;
  }

  return resolved;
}

// Files the agent must not read or change: they usually hold API keys.
const SECRET_FILE_PATTERN = /^(\.env(\..*)?|.*\.pem|id_rsa.*)$/;

export function isSecretFile(path: string): boolean {
  const name = basename(path);
  return name !== ".env.example" && SECRET_FILE_PATTERN.test(name);
}

// grep flags that keep the same secret files out of search results.
export const SECRET_GREP_EXCLUDES = [
  "--exclude=.env*",
  "--exclude=*.pem",
  "--exclude=id_rsa*",
];
