import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(authenticate, requireAdmin);

// Get all reports
router.get('/reports', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const status = req.query.status || 'pending';
  const reports = await prisma.report.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    include: {
      reporter: { select: { username: true, displayName: true } },
      reported: { select: { username: true, displayName: true } },
    },
  });
  res.json(reports);
});

// Update report status
router.patch('/reports/:id', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { status } = req.body;
  if (!['resolved', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const report = await prisma.report.update({
    where: { id: req.params.id },
    data: { status },
  });
  res.json(report);
});

// Ban/unban a user
router.patch('/users/:id/ban', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { banned } = req.body;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { isBanned: !!banned },
    select: { id: true, username: true, isBanned: true },
  });
  res.json(user);
});

// Delete a post (moderation)
router.delete('/posts/:id', async (req, res) => {
  const prisma = req.app.locals.prisma;
  await prisma.post.delete({ where: { id: req.params.id } });
  res.json({ deleted: true });
});

// List all users
router.get('/users', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, username: true, displayName: true, avatarUrl: true,
      siteUrl: true, feedUrl: true, isAdmin: true, isBanned: true,
      nodeCreated: true, createdAt: true,
      _count: { select: { posts: true, followers: true, following: true } },
    },
  });
  res.json(users);
});

// Reset a user (set nodeCreated=false, clear siteUrl/feedUrl so they re-provision)
router.post('/users/:id/reset', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { nodeCreated: false, siteUrl: null, feedUrl: null },
    select: { id: true, username: true, nodeCreated: true },
  });
  res.json(user);
});

// Delete a user and all their data
router.delete('/users/:id', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.isAdmin) return res.status(403).json({ error: 'Cannot delete admin user' });

  // Delete related records first
  await prisma.$transaction([
    prisma.like.deleteMany({ where: { userId: req.params.id } }),
    prisma.comment.deleteMany({ where: { userId: req.params.id } }),
    prisma.notification.deleteMany({ where: { userId: req.params.id } }),
    prisma.follow.deleteMany({ where: { OR: [{ followerId: req.params.id }, { followingId: req.params.id }] } }),
    prisma.report.deleteMany({ where: { OR: [{ reporterId: req.params.id }, { reportedId: req.params.id }] } }),
    prisma.externalPost.deleteMany({ where: { feed: { userId: req.params.id } } }),
    prisma.externalFeed.deleteMany({ where: { userId: req.params.id } }),
    prisma.post.deleteMany({ where: { userId: req.params.id } }),
    prisma.user.delete({ where: { id: req.params.id } }),
  ]);
  res.json({ deleted: true });
});

// Delete ALL non-admin users and their data
router.delete('/users', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const nonAdmins = await prisma.user.findMany({
    where: { isAdmin: false },
    select: { id: true },
  });
  const ids = nonAdmins.map(u => u.id);
  if (ids.length === 0) return res.json({ deleted: 0 });

  await prisma.$transaction([
    prisma.like.deleteMany({ where: { userId: { in: ids } } }),
    prisma.comment.deleteMany({ where: { userId: { in: ids } } }),
    prisma.notification.deleteMany({ where: { userId: { in: ids } } }),
    prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: ids } }, { followingId: { in: ids } }] } }),
    prisma.report.deleteMany({ where: { OR: [{ reporterId: { in: ids } }, { reportedId: { in: ids } }] } }),
    prisma.externalPost.deleteMany({ where: { feed: { userId: { in: ids } } } }),
    prisma.externalFeed.deleteMany({ where: { userId: { in: ids } } }),
    prisma.post.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
  res.json({ deleted: ids.length });
});

// Network stats
router.get('/stats', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const [users, posts, likes, comments, follows] = await Promise.all([
    prisma.user.count(),
    prisma.post.count(),
    prisma.like.count(),
    prisma.comment.count(),
    prisma.follow.count(),
  ]);
  res.json({ users, posts, likes, comments, follows });
});

export default router;
