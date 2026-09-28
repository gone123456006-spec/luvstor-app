const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { config } = require('./config');
const { HttpError } = require('./lib/http');
const { csrfGuard, requireAdmin } = require('./middleware/auth');

const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  const mediaOrigins = [config.mediaBaseUrl, config.mainApiUrl]
    .filter(Boolean)
    .map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:', 'https://lh3.googleusercontent.com', ...mediaOrigins],
          'connect-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
          'upgrade-insecure-requests': config.isProd ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Too many requests' },
    }),
  );
  api.use(csrfGuard);
  api.use('/auth', require('./routes/auth'));
  api.use(requireAdmin);
  api.use('/overview', require('./routes/overview'));
  api.use('/users', require('./routes/users'));
  api.use('/moderation', require('./routes/moderation'));
  api.use('/money', require('./routes/money'));
  api.use('/subscriptions', require('./routes/subscriptions'));
  api.use('/engagement', require('./routes/engagement'));
  api.use('/notifications', require('./routes/notifications'));
  api.use('/support', require('./routes/support'));
  api.use('/system', require('./routes/system'));
  api.use('/audit', require('./routes/audit'));
  api.use('/admins', require('./routes/admins'));
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(
      express.static(WEB_DIST, {
        index: false,
        maxAge: '1y',
        immutable: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get('/{*splat}', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(WEB_DIST, 'index.html'));
    });
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message || 'Server error';
    if (err.name === 'CastError') {
      status = 400;
      message = 'Invalid value';
    }
    if (err.type === 'entity.parse.failed') {
      status = 400;
      message = 'Invalid JSON';
    }
    if (status >= 500) {
      console.error(`[admin] ${req.method} ${req.originalUrl}:`, err);
      if (config.isProd && !(err instanceof HttpError)) message = 'Server error';
    }
    res.status(status).json({ error: message, code: err.code });
  });

  return app;
}

module.exports = { createApp };
