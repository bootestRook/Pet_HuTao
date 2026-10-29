import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Server, createRouter } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import express from 'express';
import { DuelRoom } from './room.js';
import { localUrls, originAllowed, readConfig } from './config.js';

const config = readConfig();
const isDev = process.argv.includes('--dev');
const transport = new WebSocketTransport({
  maxPayload: 8192,
  verifyClient: (info: { origin: string; req: IncomingMessage }) => originAllowed(info.origin, info.req.headers.host, config)
});
const gameServer = new Server({
  transport, greet: false,
  express: async app => {
    app.disable('x-powered-by');
    app.use((req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'");
      if (!originAllowed(req.headers.origin, req.headers.host, config)) return void res.status(403).json({ error: 'Origin not allowed' });
      next();
    });
    app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'pet-arena', version: '0.1.0' }));
    app.get('/api/config', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ publicUrl: config.publicUrl, localUrls: config.publicUrl ? [] : localUrls(config.port), version: '0.1.0' });
    });
    if (isDev) {
      const { createServer } = await import('vite');
      const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'mpa' });
      app.use(vite.middlewares);
      gameServer.onShutdown(async () => { await vite.close(); });
    } else {
      const clientDir = resolve('dist/client');
      if (!existsSync(resolve(clientDir, 'index.html'))) throw new Error('Build the client first with npm run build.');
      app.use(express.static(clientDir, { index: 'index.html', maxAge: 0 }));
    }
  }
});
// Colyseus 0.18 routes matchmaking before Express, so enforce Origin here too.
gameServer.router = createRouter({}, {
  onRequest: request => {
    if (!originAllowed(request.headers.get('origin') ?? undefined, request.headers.get('host') ?? new URL(request.url).host, config)) {
      return Response.json({ code: 403, error: 'Origin not allowed' }, { status: 403 });
    }
  }
});
gameServer.define('duel', DuelRoom);
await gameServer.listen(config.port, config.host);
console.log(`Pet Arena ready: http://localhost:${config.port}`);
for (const url of localUrls(config.port)) console.log(`LAN: ${url}`);
if (config.publicUrl) console.log(`Public: ${config.publicUrl}`);
