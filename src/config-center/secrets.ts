const ENV_PLACEHOLDER_RE = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/;
const SECRET_KEY_RE = /^(\s*(?:api_key|app_secret)\s*:\s*)(.+)$/;

export function isEnvPlaceholder(value: string): boolean {
  return ENV_PLACEHOLDER_RE.test(value.trim());
}

export function maskSecret(value: string | undefined): string {
  if (!value) return value === "" ? "(empty)" : "(not set)";
  if (isEnvPlaceholder(value)) return value;
  if (value.length <= 8) return "****";
  return `${value.slice(0, 6)}...****`;
}

export function maskSecretsInText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(SECRET_KEY_RE);
      if (!match) return line;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      return `${match[1]}${maskSecret(value)}`;
    })
    .join("\n");
}
