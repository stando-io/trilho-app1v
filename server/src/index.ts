import { createApp } from './app.js';
import { config } from './config.js';
import { startRealtime } from './realtime.js';
import { startDeadlineScheduler } from './services/notifications.js';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`API Trilho-app ouvindo em http://localhost:${config.port}`);
  if (!config.isProduction && config.sessionSecret === 'dev-secret-nao-usar-em-producao') {
    console.warn('AVISO: SESSION_SECRET de desenvolvimento em uso. Defina SESSION_SECRET em producao.');
  }
});

startRealtime(server);
startDeadlineScheduler();
