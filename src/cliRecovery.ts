export function coreIdFromFqbn(fqbn: string): string | undefined {
  const parts = fqbn.trim().split(':');
  return parts.length >= 3 && parts[0] && parts[1] ? `${parts[0]}:${parts[1]}` : undefined;
}

export function missingPlatformFromLog(log: string): string | undefined {
  const match = log.match(/Platform\s+['"]([^'"]+)['"]\s+not found|platform\s+([^\s'"`]+)\s+(?:is\s+)?not installed/i);
  return match?.[1] || match?.[2];
}
