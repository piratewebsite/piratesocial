import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Get a single post details (with EXIF, gallery, etc.)
router.get('/:postId', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const post = await prisma.post.findUnique({
    where: { id: req.params.postId },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      _count: { select: { likes: true, comments: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { username: true, displayName: true, avatarUrl: true } },
        },
      },
    },
  });
  if (!post) return res.status(404).json({ error: 'Post not found' });
  res.json(post);
});

// Manual feed refresh for authenticated user
router.post('/refresh', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.feedUrl) return res.status(400).json({ error: 'No feed URL configured' });

  const { aggregateUserFeed } = await import('../services/aggregator.js');
  try {
    const count = await aggregateUserFeed(prisma, user);
    res.json({ success: true, postsProcessed: count });
  } catch (err) {
    console.error(`Manual feed refresh failed for ${user.username}:`, err);
    res.status(500).json({ error: 'Feed refresh failed' });
  }
});

export default router;
