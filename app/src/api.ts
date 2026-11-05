import { getSecurityPassword } from './securityPassword';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error?: { message?: string };
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

let securityPromptOpen = false;
const securityPromptResolvers: Array<(password: string | null) => void> = [];

function requestSecurityPassword(): Promise<string | null> {
  if (!securityPromptOpen) {
    securityPromptOpen = true;
    window.dispatchEvent(new CustomEvent('trilho:security-password-required'));
  }
  return new Promise((resolve) => {
    securityPromptResolvers.push(resolve);
  });
}

export function completeSecurityPrompt(password: string | null): void {
  securityPromptOpen = false;
  const resolvers = securityPromptResolvers.splice(0);
  for (const resolve of resolvers) resolve(password);
}

function isSecurityMessage(status: number, message: string): boolean {
  return status === 400 && /senha de segurança/i.test(message);
}

function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_URL ?? '';
}

async function requestOnce<T>(
  path: string,
  options: RequestInit,
  passwordOverride?: string | null,
): Promise<T> {
  const { headers, body: requestBody, method: reqMethod, ...rest } = options;
  const securityPassword = passwordOverride ?? getSecurityPassword();
  const baseUrl = getApiBaseUrl();
  const url = baseUrl ? `${baseUrl}/api/v1${path}` : `/api/v1${path}`;

  let finalBody: BodyInit | null | undefined = requestBody as BodyInit | null | undefined;
  if (typeof requestBody === 'string') {
    finalBody = requestBody;
  } else if (requestBody && typeof requestBody === 'object' && !(requestBody instanceof FormData) && !(requestBody instanceof Blob) && !(requestBody instanceof ArrayBuffer)) {
    finalBody = JSON.stringify(requestBody);
  } else {
    finalBody = requestBody as BodyInit | null | undefined;
  }

  const res = await fetch(url, {
    method: reqMethod ?? 'GET',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(securityPassword ? { 'x-security-password': securityPassword } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: reqMethod && reqMethod.toUpperCase() !== 'GET' && reqMethod.toUpperCase() !== 'HEAD' ? finalBody : undefined,
    ...rest,
  });

  if (res.status === 204) {
    await res.text();
    return undefined as T;
  }

  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      body && typeof body === 'object' && (body as ErrorBody).error?.message
        ? (body as ErrorBody).error!.message!
        : 'Erro inesperado. Tente novamente.';
    throw new ApiError(res.status, message);
  }

  return body as T;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  try {
    return await requestOnce<T>(path, options);
  } catch (error) {
    if (
      error instanceof ApiError &&
      isSecurityMessage(error.status, error.message) &&
      MUTATING_METHODS.has(method)
    ) {
      const password = await requestSecurityPassword();
      if (!password) throw error;
      return requestOnce<T>(path, options, password);
    }
    throw error;
  }
}
