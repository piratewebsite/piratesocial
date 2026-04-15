import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Get user profile by username
router.get('/:username', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({
    where: { username: req.params.username },
    select: {
      id: true, username: true, displayName: true, bio: true,
      avatarUrl: true, siteUrl: true, feedUrl: true, location: true,
      camera: true, createdAt: true,
      _count: { select: { followers: true, following: true, posts: true } },
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// Update own profile
router.patch('/me', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const allowed = ['displayName', 'bio', 'avatarUrl', 'siteUrl', 'feedUrl', 'location', 'camera', 'website'];
  const data = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data,
    select: {
      id: true, username: true, displayName: true, bio: true,
      avatarUrl: true, siteUrl: true, feedUrl: true, location: true,
      camera: true, createdAt: true,
    },
  });
  res.json(user);
});

// Get user's posts
router.get('/:username/posts', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({ where: { username: req.params.username } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  const posts = await prisma.post.findMany({
    where: { userId: user.id },
    orderBy: { pubDate: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      _count: { select: { likes: true, comments: true } },
      user: { select: { username: true, displayName: true, avatarUrl: true } },
    },
  });
  res.json({ posts, page, limit });
});

// Get user's followers
router.get('/:username/followers', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({ where: { username: req.params.username } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const followers = await prisma.follow.findMany({
    where: { followingId: user.id },
    include: { follower: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
  });
  res.json(followers.map(f => f.follower));
});

// Get who user is following
router.get('/:username/following', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({ where: { username: req.params.username } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const following = await prisma.follow.findMany({
    where: { followerId: user.id },
    include: { following: { select: { id: true, username: true, displayName: true, avatarUrl: true } } },
  });
  res.json(following.map(f => f.following));
});

export default router;
