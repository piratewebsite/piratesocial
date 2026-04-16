import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  verifyBlueskyCredentials,
  getBlueskyThread,
  likeBlueskyPost,
  unlikeBlueskyPost,
  replyOnBluesky,
} from '../services/bluesky.js';

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

// Get a Bluesky session (accessJwt/refreshJwt) for browser-side API calls.
// Uses the stored app password to create a session, returns tokens to the browser.
router.get('/session', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { blueskyHandle: true, blueskyAppPassword: true, blueskyDid: true },
  });

  if (!user?.blueskyHandle || !user?.blueskyAppPassword) {
    return res.status(400).json({ error: 'Bluesky account not connected' });
  }

  try {
    const response = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: user.blueskyHandle, password: user.blueskyAppPassword }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.message || 'Failed to create Bluesky session' });
    }

    const data = await response.json();
    res.json({
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
      did: data.did,
      handle: data.handle,
    });
  } catch (err) {
    console.error('Bluesky session error:', err.message);
    res.status(500).json({ error: 'Failed to create Bluesky session' });
  }
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

// Get merged comments (Bluesky thread + Pirate Social comments) for a post
router.get('/thread/:postId', async (req, res) => {
  const prisma = req.app.locals.prisma;
  const post = await prisma.post.findUnique({
    where: { id: req.params.postId },
    select: {
      id: true,
      blueskyUri: true,
      comments: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { username: true, displayName: true, avatarUrl: true } },
        },
      },
      _count: { select: { likes: true } },
    },
  });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // Fetch Bluesky thread if the post was cross-posted
  let bsky = { replies: [], likeCount: 0, repostCount: 0, bskyUrl: null };
  if (post.blueskyUri) {
    bsky = await getBlueskyThread(post.blueskyUri);
  }

  // Normalize Pirate Social comments into the same shape
  const psComments = post.comments.map(c => ({
    id: c.id,
    text: c.body,
    createdAt: c.createdAt,
    source: 'piratesocial',
    author: {
      handle: c.user.username,
      displayName: c.user.displayName || c.user.username,
      avatar: c.user.avatarUrl,
    },
    depth: 0,
  }));

  // Normalize Bluesky replies
  const bskyComments = bsky.replies.map(r => ({
    id: r.uri,
    text: r.text,
    createdAt: r.createdAt,
    source: 'bluesky',
    author: r.author,
    depth: r.depth,
    uri: r.uri,
    cid: r.cid,
  }));

  // Merge and sort by date
  const allComments = [...psComments, ...bskyComments].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  res.json({
    comments: allComments,
    likeCount: post._count.likes,
    bskyLikeCount: bsky.likeCount,
    bskyRepostCount: bsky.repostCount,
    bskyUrl: bsky.bskyUrl,
    blueskyUri: post.blueskyUri,
  });
});

// Bridge a like to Bluesky — called after liking on Pirate Social
router.post('/like-bridge/:postId', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.blueskyEnabled) {
    return res.json({ bridged: false, reason: 'Bluesky not enabled' });
  }

  const post = await prisma.post.findUnique({ where: { id: req.params.postId } });
  if (!post?.blueskyUri) {
    return res.json({ bridged: false, reason: 'Post not on Bluesky' });
  }

  // We need the CID of the root post to like it
  const bskyThread = await getBlueskyThread(post.blueskyUri);
  // Find the root post CID from the thread response
  // We can fetch it directly
  try {
    const { AtpAgent } = await import('@atproto/api');
    const pubAgent = new AtpAgent({ service: 'https://public.api.bsky.app' });
    const threadRes = await pubAgent.getPostThread({ uri: post.blueskyUri, depth: 0 });
    const rootCid = threadRes.data.thread?.post?.cid;

    if (!rootCid) {
      return res.json({ bridged: false, reason: 'Could not find post CID' });
    }

    const likeUri = await likeBlueskyPost(user, post.blueskyUri, rootCid);
    res.json({ bridged: !!likeUri, likeUri });
  } catch (err) {
    console.warn('[bluesky] Like bridge failed:', err.message);
    res.json({ bridged: false, reason: err.message });
  }
});

// Unlike on Bluesky
router.post('/unlike-bridge', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const { likeUri } = req.body;
  if (!likeUri) return res.json({ bridged: false });

  const success = await unlikeBlueskyPost(user, likeUri);
  res.json({ bridged: success });
});

// Reply on Bluesky thread (comment bridging)
router.post('/reply/:postId', authenticate, async (req, res) => {
  const prisma = req.app.locals.prisma;
  const { text } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text required' });

  const sanitizedText = text.replace(/<[^>]*>/g, '').trim().slice(0, 300);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user?.blueskyEnabled) {
    return res.json({ bridged: false, reason: 'Bluesky not enabled' });
  }

  const post = await prisma.post.findUnique({ where: { id: req.params.postId } });
  if (!post?.blueskyUri) {
    return res.json({ bridged: false, reason: 'Post not on Bluesky' });
  }

  try {
    const { AtpAgent } = await import('@atproto/api');
    const pubAgent = new AtpAgent({ service: 'https://public.api.bsky.app' });
    const threadRes = await pubAgent.getPostThread({ uri: post.blueskyUri, depth: 0 });
    const rootPost = threadRes.data.thread?.post;

    if (!rootPost) {
      return res.json({ bridged: false, reason: 'Could not find Bluesky post' });
    }

    const replyUri = await replyOnBluesky(
      user,
      post.blueskyUri,
      rootPost.cid,
      post.blueskyUri,
      rootPost.cid,
      sanitizedText
    );
    res.json({ bridged: !!replyUri, replyUri });
  } catch (err) {
    console.warn('[bluesky] Reply bridge failed:', err.message);
    res.json({ bridged: false, reason: err.message });
  }
});

export default router;
