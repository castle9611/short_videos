// Pages deployment: set this to your HTTPS backend origin, without trailing slash.
window.APP_CONFIG = { apiBase: location.hostname.endsWith('github.io') ? 'https://shiying-api.castle9611-shiying.workers.dev' : '' };
