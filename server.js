const path = require('node:path');
const Fastify = require('fastify');
const fastifyStatic = require('@fastify/static');
const { WebSocketServer } = require('ws');

// Import modules
const { logEvent } = require('./lib/logger');
const { PORT, KEEPALIVE_MS } = require('./lib/config');
const { getLocalNetworkAddresses } = require('./lib/network');
const { send } = require('./lib/message');
const { disconnectPlayer } = require('./lib/room-manager');
const { handleRealtimeMessage } = require('./lib/ws-protocol');
const { registerApiRoutes } = require('./lib/api-routes');

// Fastify instance with logger disabled to keep output minimal.
const app = Fastify({ logger: false });

// Enable websocket support and static file serving.
app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
});

// Register API routes
registerApiRoutes(app);

// Raw ws server mounted over the same HTTP server used by Fastify.
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws, req) => {
  logEvent('ws_connected', { remoteAddress: req.socket?.remoteAddress || null });

  // Start keepalive pings every 25s to prevent Safari from closing idle connections.
  const keepaliveInterval = setInterval(() => {
    if (ws.readyState === 1) {
      // 1 = OPEN
      send(ws, { type: 'ping' });
    }
  }, KEEPALIVE_MS);

  ws.on('message', (raw) => {
    handleRealtimeMessage(ws, req, raw);
  });

  ws.on('close', () => {
    logEvent('ws_closed', { roomCode: ws.roomCode || null, playerId: ws.playerId || null });
    disconnectPlayer(ws);
    clearInterval(keepaliveInterval);
  });
});

app.server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url || '/', 'http://localhost');

  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// Serve single-page client.
app.get('/', async (req, reply) => reply.sendFile('index.html'));

process.on('uncaughtException', (error) => {
  logEvent('uncaught_exception', { message: error.message, stack: error.stack || null });
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack || null : null;
  logEvent('unhandled_rejection', { message, stack });
  console.error('Unhandled rejection:', reason);
});

// Start HTTP server on all interfaces to allow LAN devices to connect.
app.listen({ port: PORT, host: '0.0.0.0' })
  .then(() => {
    logEvent('server_started', { port: PORT, pid: process.pid });
    console.log(`Quiz server listening on http://localhost:${PORT}`);
    const lans = getLocalNetworkAddresses();
    for (const ip of lans) {
      console.log(`LAN access: http://${ip}:${PORT}`);
    }
  })
  .catch((error) => {
    logEvent('server_start_error', { message: error.message, stack: error.stack || null });
    console.error('Server start error:', error);
    process.exit(1);
  });
