import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { verifyBlueskyCredentials } from '../services/bluesky.js';

const router = Router();

// Get current user's Bluesky connection status
router.get('/status', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      blueskyHandle: true,
      blueskyDid: true,
      blueskyEnabled: true,
    },
  });
  res.json({
    connected: !!user?.blueskyHandle,
    enabled: user?.blueskyEnabled || false,
    handle: user?.blueskyHandle || null,
    did: user?.blueskyDid || null,
  });
});

// Connect Bluesky account (save handle + app password)
router.post('/connect', authenticate, async (req, res) => {
  const { handle, appPassword } = req.body;
  if (!handle || !appPassword) {
    return res.status(400).json({ error: 'Handle and app password are required' });
  }

  // Verify credentials first
  const verification = await verifyBlueskyCredentials(handle, appPassword);
  if (!verification.valid) {
    return res.status(400).json({ error: `Invalid credentials: ${verification.error}` });
  }

  const prisma = req.app.locals.prisma;
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      blueskyHandle: verification.handle,
      blueskyDid: verification.did,
      blueskyAppPassword: appPassword,
      blueskyEnabled: true,
    },
  });

  res.json({
    success: true,
    handle: verification.handle,
    did: verification.did,
  });
});

// Disconnect Bluesky account
router.post('/disconnect', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      blueskyHandle: null,
      blueskyDid: null,
      blueskyAppPassword: null,
      blueskyEnabled: false,
    },
  });
  res.json({ success: true });
});

// Toggle cross-posting on/off
router.post('/toggle', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.blueskyHandle) {
    return res.status(400).json({ error: 'Bluesky account not connected' });
  }

  const enabled = !user.blueskyEnabled;
  await prisma.user.update({
    where: { id: req.user.id },
    data: { blueskyEnabled: enabled },
  });
  res.json({ enabled });
});

export default router;
