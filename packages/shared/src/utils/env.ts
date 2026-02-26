function stripSurroundingQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const startsWithDouble = trimmed.startsWith('"') && trimmed.endsWith('"');
  const startsWithSingle = trimmed.startsWith("'") && trimmed.endsWith("'");
  if (startsWithDouble || startsWithSingle) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function readEnv(name: string, fallback = ''): string {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const cleaned = stripSurroundingQuotes(raw);
  return cleaned.length > 0 ? cleaned : fallback;
}
