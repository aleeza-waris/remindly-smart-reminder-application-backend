import cors from 'cors';

const DEVELOPMENT_ORIGIN = 'http://localhost:3000';
const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Authorization', 'Content-Type', 'X-Timezone'];

export const parseClientOrigins = (configuredOrigins, environment = process.env.NODE_ENV) => {
  const rawOrigins = configuredOrigins?.trim();

  if (!rawOrigins) {
    if (environment === 'production') {
      throw new Error('CLIENT_ORIGINS must contain the production frontend origin in production.');
    }
    return [DEVELOPMENT_ORIGIN];
  }

  const origins = rawOrigins.split(',').map((value) => value.trim());
  if (origins.some((origin) => !origin)) {
    throw new Error('CLIENT_ORIGINS must be a comma-separated list of valid origins.');
  }

  const validatedOrigins = origins.map((origin) => {
    let parsedOrigin;
    try {
      parsedOrigin = new URL(origin);
    } catch {
      throw new Error(`CLIENT_ORIGINS contains an invalid origin: ${origin}`);
    }

    const isHttpOrigin = parsedOrigin.protocol === 'http:' || parsedOrigin.protocol === 'https:';
    const hasPathOrQuery =
      parsedOrigin.pathname !== '/' || parsedOrigin.search !== '' || parsedOrigin.hash !== '';
    const hasCredentials = parsedOrigin.username !== '' || parsedOrigin.password !== '';
    const productionRequiresHttps =
      environment === 'production' && parsedOrigin.protocol !== 'https:';

    if (
      !isHttpOrigin ||
      parsedOrigin.origin !== origin ||
      hasPathOrQuery ||
      hasCredentials ||
      productionRequiresHttps
    ) {
      throw new Error(`CLIENT_ORIGINS contains an invalid origin: ${origin}`);
    }

    return parsedOrigin.origin;
  });

  return [...new Set(validatedOrigins)];
};

export const createCorsMiddleware = (
  configuredOrigins = process.env.CLIENT_ORIGINS,
  environment = process.env.NODE_ENV
) => {
  const allowedOrigins = parseClientOrigins(configuredOrigins, environment);

  return cors({
    origin(origin, callback) {
      callback(null, Boolean(origin && allowedOrigins.includes(origin)));
    },
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    credentials: false,
    optionsSuccessStatus: 204,
  });
};
