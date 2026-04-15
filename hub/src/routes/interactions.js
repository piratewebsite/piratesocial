import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendNotification } from '../utils/notify.js';

const router = Router();

// Like a post
router.post('/like', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { postId } = req.body;
  if (!postId) return res.status(400).json({ error: 'postId required' });

  const post = await prisma.post.findUnique({ where: { id: postId }, include: { user: true } });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  try {
    const like = await prisma.like.create({
      data: { userId: req.user.id, postId },
    });

    // Notify post author
    if (post.userId !== req.user.id) {
      await sendNotification(req.app, prisma, post.userId, 'like', {
        fromUser: req.user.username,
        postId,
        postTitle: post.title,
      });
    }

    const count = await prisma.like.count({ where: { postId } });
    res.json({ liked: true, count });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Already liked' });
    }
    throw err;
  }
});

// Unlike a post
router.delete('/like', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { postId } = req.body;
  if (!postId) return res.status(400).json({ error: 'postId required' });

  await prisma.like.deleteMany({
    where: { userId: req.user.id, postId },
  });

  const count = await prisma.like.count({ where: { postId } });
  res.json({ liked: false, count });
});

// Comment on a post
router.post('/comment', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { postId, body } = req.body;
  if (!postId || !body?.trim()) {
    return res.status(400).json({ error: 'postId and body required' });
  }

  // Sanitize: strip HTML tags from comment body
  const sanitizedBody = body.replace(/<[^>]*>/g, '').trim().slice(0, 2000);

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const comment = await prisma.comment.create({
    data: { userId: req.user.id, postId, body: sanitizedBody },
    include: {
      user: { select: { username: true, displayName: true, avatarUrl: true } },
    },
  });

  // Notify post author
  if (post.userId !== req.user.id) {
    await sendNotification(req.app, prisma, post.userId, 'comment', {
      fromUser: req.user.username,
      postId,
      postTitle: post.title,
      commentPreview: sanitizedBody.slice(0, 100),
    });
  }

  res.status(201).json(comment);
});

// Get comments for a post
router.get('/comments/:postId', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const comments = await prisma.comment.findMany({
    where: { postId: req.params.postId },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { username: true, displayName: true, avatarUrl: true } },
    },
  });
  res.json(comments);
});

// Delete own comment
router.delete('/comment/:commentId', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const comment = await prisma.comment.findUnique({ where: { id: req.params.commentId } });
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.userId !== req.user.id && !req.user.isAdmin) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  await prisma.comment.delete({ where: { id: req.params.commentId } });
  res.json({ deleted: true });
});

// Follow a user
router.post('/follow', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  try {
    await prisma.follow.create({
      data: { followerId: req.user.id, followingId: userId },
    });

    await sendNotification(req.app, prisma, userId, 'follow', {
      fromUser: req.user.username,
    });

    res.json({ following: true });
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Already following' });
    }
    throw err;
  }
});

// Unfollow a user
router.delete('/follow', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  await prisma.follow.deleteMany({
    where: { followerId: req.user.id, followingId: userId },
  });
  res.json({ following: false });
});

// Get notifications
router.get('/notifications', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.notification.count({
      where: { userId: req.user.id, read: false },
    }),
  ]);

  res.json({ notifications, unreadCount, page, limit });
});

// Mark notifications as read
router.post('/notifications/read', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { ids } = req.body; // array of notification IDs, or omit for all

  if (ids?.length) {
    await prisma.notification.updateMany({
      where: { id: { in: ids }, userId: req.user.id },
      data: { read: true },
    });
  } else {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true },
    });
  }
  res.json({ success: true });
});

// Report a user or post
router.post('/report', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { reportedId, postId, reason } = req.body;
  if (!reportedId || !reason?.trim()) {
    return res.status(400).json({ error: 'reportedId and reason required' });
  }

  await prisma.report.create({
    data: {
      reporterId: req.user.id,
      reportedId,
      postId: postId || null,
      reason: reason.trim().slice(0, 1000),
    },
  });
  res.status(201).json({ reported: true });
});

export default router;
