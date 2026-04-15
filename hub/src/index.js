import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import feedRoutes from './routes/feed.js';
import timelineRoutes from './routes/timeline.js';
import interactionRoutes from './routes/interactions.js';
import webhookRoutes from './routes/webhooks.js';
import adminRoutes from './routes/admin.js';
import directoryRoutes from './routes/directory.js';
import { aggregateAllFeeds } from './services/aggregator.js';

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(helmet());
app.use(express.json({ limit: '5mb' }));

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, etc.)
    if (!origin) return callback(null, true);
    // Allow any *.github.io site (user nodes)
    if (origin.endsWith('.github.io')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Make prisma available to routes
app.locals.prisma = prisma;

// --- Routes ---
app.get('/', (_req, res) => {
  res.json({
    name: 'Pirate Social Hub',
    version: '1.0.0',
    description: 'Distributed photography social network hub',
    endpoints: {
      auth: '/api/auth',
      users: '/api/users',
      timeline: '/api/timeline',
      feed: '/api/feed',
      interactions: '/api/interactions',
      directory: '/api/directory',
      webhooks: '/api/webhooks',
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/timeline', timelineRoutes);
app.use('/api/interactions', interactionRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/directory', directoryRoutes);

// --- SSE endpoint for real-time updates ---
const sseClients = new Map(); // userId -> Set<res>

app.get('/api/stream', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('data: {"type":"connected"}\n\n');

  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  req.on('close', () => {
    sseClients.get(userId)?.delete(res);
    if (sseClients.get(userId)?.size === 0) sseClients.delete(userId);
  });
});

// Export for use in interaction routes
app.locals.sseClients = sseClients;

// --- Error handler ---
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// --- Feed aggregation cron ---
const pollInterval = parseInt(process.env.FEED_POLL_INTERVAL || '10', 10);
cron.schedule(`*/${pollInterval} * * * *`, async () => {
  console.log(`[cron] Aggregating feeds...`);
  try {
    await aggregateAllFeeds(prisma);
    console.log(`[cron] Feed aggregation complete`);
  } catch (err) {
    console.error(`[cron] Feed aggregation failed:`, err);
  }
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`🏴‍☠️ Pirate Social Hub running on port ${PORT}`);
});

export default app;
