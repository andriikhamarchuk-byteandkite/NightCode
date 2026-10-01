import { resolve, relative, isAbsolute, sep } from "path";

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
