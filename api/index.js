// api/index.js
// Vercel entry point. Express apps are directly callable as (req, res)
// handlers, so we just re-export it -- src/server.js only calls app.listen
// when run directly (`node src/server.js`), not when required like this,
// so this stays a stateless per-request handler as Vercel expects.

module.exports = require('../src/server');
