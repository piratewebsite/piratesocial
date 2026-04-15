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
