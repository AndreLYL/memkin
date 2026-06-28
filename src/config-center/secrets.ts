const ENV_PLACEHOLDER_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const SECRET_KEY_RE = /^(\s*(?:api_key|app_secret)\s*:\s*)(.+)$/;
const DATABASE_URL_KEY_RE = /^(\s*database_url\s*:\s*)(.+)$/;

export function isEnvPlaceholder(value: string): boolean {
  return ENV_PLACEHOLDER_RE.test(value.trim());
}

export function maskSecret(value: string | undefined): string {
  if (!value) return value === "" ? "(empty)" : "(not set)";
  if (isEnvPlaceholder(value)) return value;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 6)}...****`;
}

/**
 * Masks the password segment of a PostgreSQL connection string.
 * Leaves ${ENV} placeholders completely untouched.
 */
export function maskDatabaseUrl(url: string): string {
  if (url.includes("${")) return url;
  try {
    const u = new URL(url);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return url;
  }
}

export function maskSecretsInText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const secretMatch = line.match(SECRET_KEY_RE);
      if (secretMatch) {
        const value = secretMatch[2].trim().replace(/^["']|["']$/g, "");
        return `${secretMatch[1]}${maskSecret(value)}`;
      }
      const dbUrlMatch = line.match(DATABASE_URL_KEY_RE);
      if (dbUrlMatch) {
        const value = dbUrlMatch[2].trim().replace(/^["']|["']$/g, "");
        return `${dbUrlMatch[1]}${maskDatabaseUrl(value)}`;
      }
      return line;
    })
    .join("\n");
}
