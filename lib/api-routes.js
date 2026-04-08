const QRCode = require('qrcode');
const { QUESTIONS } = require('./config');
const { getLocalNetworkAddresses } = require('./network');
const { rooms } = require('./room-manager');

// Register API routes on the Fastify instance.
function registerApiRoutes(app) {
  // Health endpoint for quick diagnostics.
  app.get('/api/health', async () => ({ ok: true, rooms: rooms.size }));

  // Expose loaded question count.
  app.get('/api/questions/count', async () => ({ total: QUESTIONS.length }));

  // Expose discovered local network interfaces.
  app.get('/api/network', async () => ({
    addresses: getLocalNetworkAddresses(),
  }));

  // Return SVG QR for arbitrary text (used to join room by URL).
  app.get('/api/qr', async (req, reply) => {
    const text = typeof req.query.text === 'string' ? req.query.text : '';
    if (!text) {
      return reply.code(400).send({ error: 'Falta query param text' });
    }

    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 280 });
    reply.header('Content-Type', 'image/svg+xml');
    return reply.send(svg);
  });
}

module.exports = { registerApiRoutes };
