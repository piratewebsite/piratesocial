import { Router } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth.js';

const router = Router();

// Get personalized timeline (posts from people you follow)
router.get('/', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  // Get IDs of users the current user follows
  const following = await prisma.follow.findMany({
    where: { followerId: req.user.id },
    select: { followingId: true },
  });
  const followingIds = following.map(f => f.followingId);

  // Include own posts in timeline
  followingIds.push(req.user.id);

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: { userId: { in: followingIds } },
      orderBy: { pubDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        _count: { select: { likes: true, comments: true } },
        likes: {
          where: { userId: req.user.id },
          select: { id: true },
        },
      },
    }),
    prisma.post.count({ where: { userId: { in: followingIds } } }),
  ]);

  // Transform to include hasLiked flag
  const enrichedPosts = posts.map(post => ({
    ...post,
    hasLiked: post.likes.length > 0,
    likes: undefined, // remove raw likes array
    likeCount: post._count.likes,
    commentCount: post._count.comments,
  }));

  res.json({ posts: enrichedPosts, total, page, limit, hasMore: page * limit < total });
});

// Global/discover timeline (all public posts)
router.get('/discover', optionalAuth, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const tag = req.query.tag;

  const where = tag ? { tags: { has: tag } } : {};

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where,
      orderBy: { pubDate: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
        _count: { select: { likes: true, comments: true } },
        ...(req.user ? {
          likes: { where: { userId: req.user.id }, select: { id: true } },
        } : {}),
      },
    }),
    prisma.post.count({ where }),
  ]);

  const enrichedPosts = posts.map(post => ({
    ...post,
    hasLiked: req.user ? (post.likes?.length > 0) : false,
    likes: undefined,
    likeCount: post._count.likes,
    commentCount: post._count.comments,
  }));

  res.json({ posts: enrichedPosts, total, page, limit, hasMore: page * limit < total });
});

// Search posts
router.get('/search', optionalAuth, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const q = req.query.q?.trim();
  if (!q) return res.status(400).json({ error: 'Search query required' });

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));

  const posts = await prisma.post.findMany({
    where: {
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { tags: { has: q.toLowerCase() } },
      ],
    },
    orderBy: { pubDate: 'desc' },
    skip: (page - 1) * limit,
    take: limit,
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      _count: { select: { likes: true, comments: true } },
    },
  });

  res.json({ posts, page, limit });
});

export default router;
