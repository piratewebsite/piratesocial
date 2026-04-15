import { Router } from 'express';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// Public directory of all users on the network
router.get('/', optionalAuth, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const search = req.query.q?.trim();

  const where = {
    isBanned: false,
    ...(search ? {
      OR: [
        { username: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
        { bio: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
      ],
    } : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, username: true, displayName: true, bio: true,
        avatarUrl: true, siteUrl: true, location: true, camera: true,
        createdAt: true,
        _count: { select: { followers: true, following: true, posts: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({ users, total, page, limit, hasMore: page * limit < total });
});

// Public JSON feed of all nodes (for static consumption)
router.get('/nodes.json', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const users = await prisma.user.findMany({
    where: { isBanned: false, feedUrl: { not: null } },
    select: {
      username: true, displayName: true, avatarUrl: true,
      siteUrl: true, feedUrl: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json({
    name: 'Pirate Social Network',
    updated: new Date().toISOString(),
    nodeCount: users.length,
    nodes: users,
  });
});

export default router;
