import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: { message: 'Rota não encontrada' } });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    const message = error.issues[0]?.message ?? 'Dados inválidos';
    res.status(400).json({ error: { message } });
    return;
  }
  console.error('Erro nao tratado:', error);
  res.status(500).json({ error: { message: 'Erro interno do servidor' } });
}
