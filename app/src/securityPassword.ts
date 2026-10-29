let cached: string | null = null;

export function getSecurityPassword(): string | null {
  return cached;
}

export function storeSecurityPassword(value: string | null): void {
  cached = value;
}
