import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import ConnectPgSimple from 'connect-pg-simple';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { globalSecurityGuard } from './middleware/globalSecurity.js';
import { SCREENS } from './services/screens.js';
import authRouter from './routes/auth.js';
import apiKeysRouter from './routes/apiKeys.js';
import profilesRouter from './routes/profiles.js';
import rolesRouter from './routes/roles.js';
import usersRouter from './routes/users.js';
import settingsRouter from './routes/settings.js';
import notificationsRouter from './routes/notifications.js';
import projectsRouter from './routes/projects.js';
import webhooksRouter from './routes/webhooks.js';

const PgSession = ConnectPgSimple(session);

function getAllowedOrigins(): string[] {
  const origins = [config.baseUrl];
  if (config.nodeEnv === 'production') {
    const extra = process.env.EXTRA_CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
    origins.push(...extra);
  } else {
    origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  }
  return origins;
}

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: getAllowedOrigins(), credentials: true }));
  app.use(express.json({ limit: '4mb' }));

  const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
  app.use('/uploads', express.static(uploadsDir, { fallthrough: true }));

  app.use(
    session({
      name: 'trilho.sid',
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: new PgSession({ pool, tableName: 'sessions' }),
      cookie: {
        httpOnly: true,
        sameSite: config.isProduction ? 'none' : 'lax',
        secure: config.cookieSecure,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/api/v1/meta/screens', (_req, res) => {
    res.json({ screens: SCREENS });
  });

  app.use('/api/v1', globalSecurityGuard);

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/keys', apiKeysRouter);
  app.use('/api/v1/profiles', profilesRouter);
  app.use('/api/v1/roles', rolesRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/projects', projectsRouter);
  app.use('/api/v1/webhooks', webhooksRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
