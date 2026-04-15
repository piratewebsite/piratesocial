import { Router } from 'express';

const router = Router();

// Webhook: user node notifies hub that their feed was updated
router.post('/feed-updated', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { username, feedUrl } = req.body;

  if (!username && !feedUrl) {
    return res.status(400).json({ error: 'username or feedUrl required' });
  }

  const where = username ? { username } : { feedUrl };
  const user = await prisma.user.findFirst({ where });
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

  // Import aggregator and process single feed
  const { aggregateUserFeed } = await import('../services/aggregator.js');
  try {
    await aggregateUserFeed(prisma, user);
    res.json({ success: true, message: 'Feed processed' });
  } catch (err) {
    console.error(`Webhook feed update failed for ${user.username}:`, err);
    res.status(500).json({ error: 'Feed processing failed' });
  }
});

export default router;
