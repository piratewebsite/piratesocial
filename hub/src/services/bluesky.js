import { AtpAgent, RichText } from '@atproto/api';

// Cache authenticated agents to avoid re-login on every request.
// Key: `${userId}`, Value: { agent, expiresAt }
const agentCache = new Map();
const AGENT_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Create an authenticated Bluesky agent for a user.
 * Caches the agent to avoid repeated logins (rate limit cause).
 * If no user is provided, creates an unauthenticated agent for public reads.
 */
export async function createAgent(user) {
  if (user?.id && user?.blueskyHandle && user?.blueskyAppPassword) {
    const cached = agentCache.get(user.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.agent;
    }

    const agent = new AtpAgent({ service: 'https://bsky.social' });
    await agent.login({
      identifier: user.blueskyHandle,
      password: user.blueskyAppPassword,
    });
    agentCache.set(user.id, { agent, expiresAt: Date.now() + AGENT_TTL });
    return agent;
  }

  return new AtpAgent({ service: 'https://bsky.social' });
}

/**
 * Cross-post a Pirate Social post to Bluesky.
 * Downloads the image if present and attaches it as an embed.
 */
export async function crossPostToBluesky(user, post) {
  if (!user.blueskyEnabled || !user.blueskyHandle || !user.blueskyAppPassword) {
    return null;
  }

  try {
    const agent = await createAgent(user);

    // Build rich text with link to original post
    const text = `${post.title}${post.description ? `\n\n${post.description}` : ''}\n\n${post.link}`;
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    // Build the post record
    const record = {
      $type: 'app.bsky.feed.post',
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    };

    // If there's an image, download and upload it as an embed
    if (post.imageUrl) {
      try {
        const imageBlob = await downloadImage(post.imageUrl);
        if (imageBlob) {
          const uploaded = await agent.uploadBlob(imageBlob.data, {
            encoding: imageBlob.mimeType,
          });
          const blobRef = uploaded.data?.blob || uploaded.data;
          record.embed = {
            $type: 'app.bsky.embed.images',
            images: [
              {
                alt: post.title || 'Photo',
                image: blobRef,
              },
            ],
          };
        } else {
          // Image download failed — use link card
          record.embed = {
            $type: 'app.bsky.embed.external',
            external: {
              uri: post.link,
              title: post.title,
              description: post.description || '',
            },
          };
        }
      } catch (imgErr) {
        console.warn(`[bluesky] Image upload failed for "${post.title}":`, imgErr.message);
        record.embed = {
          $type: 'app.bsky.embed.external',
          external: {
            uri: post.link,
            title: post.title,
            description: post.description || '',
          },
        };
      }
    } else {
      // No image — use a link card
      record.embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: post.link,
          title: post.title,
          description: post.description || '',
        },
      };
    }

    // Add EXIF data as tags if available
    if (post.exifData) {
      const tags = [];
      if (post.exifData.camera) tags.push(post.exifData.camera.replace(/\s+/g, ''));
      if (post.exifData.lens) tags.push('photography');
      if (tags.length > 0) {
        record.tags = tags.slice(0, 8); // Bluesky max 8 tags
      }
    }

    // Add post tags
    if (post.tags?.length > 0) {
      record.tags = [...new Set([...(record.tags || []), ...post.tags])].slice(0, 8);
    }

    const response = await agent.post(record);
    console.log(`[bluesky] Cross-posted "${post.title}" for ${user.username}: ${response.uri}`);
    return response.uri;
  } catch (err) {
    console.error(`[bluesky] Cross-post failed for ${user.username}:`, err.message);
    return null;
  }
}

/**
 * Verify Bluesky credentials are valid.
 */
export async function verifyBlueskyCredentials(handle, appPassword) {
  try {
    const agent = new AtpAgent({ service: 'https://bsky.social' });
    const result = await agent.login({
      identifier: handle,
      password: appPassword,
    });
    return { valid: true, did: result.data.did, handle: result.data.handle };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Download an image from a URL, return buffer + mime type.
 */
async function downloadImage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PirateSocial-Hub/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await res.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    // Bluesky has a 1MB limit for blobs
    if (data.length > 1_000_000) {
      console.warn(`[bluesky] Image too large (${(data.length / 1024 / 1024).toFixed(1)}MB), skipping embed`);
      return null;
    }

    return { data, mimeType: contentType };
  } catch {
    return null;
  }
}

/**
 * Parse an at:// URI into { repo, collection, rkey }.
 */
function parseAtUri(uri) {
  const match = uri?.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { repo: match[1], collection: match[2], rkey: match[3] };
}

/**
 * Fetch the Bluesky thread (replies) for a cross-posted post.
 * Returns normalized comments with author info.
 */
export async function getBlueskyThread(blueskyUri) {
  if (!blueskyUri) return { replies: [], likeCount: 0, repostCount: 0 };

  try {
    const agent = new AtpAgent({ service: 'https://public.api.bsky.app' });
    const res = await agent.getPostThread({ uri: blueskyUri, depth: 6 });
    const thread = res.data.thread;

    if (!thread || thread.$type === 'app.bsky.feed.defs#notFoundPost') {
      return { replies: [], likeCount: 0, repostCount: 0 };
    }

    const likeCount = thread.post?.likeCount || 0;
    const repostCount = thread.post?.repostCount || 0;
    const bskyUrl = blueskyUriToUrl(blueskyUri, thread.post?.author?.handle);

    const replies = flattenReplies(thread.replies || [], 0);

    return { replies, likeCount, repostCount, bskyUrl };
  } catch (err) {
    console.warn(`[bluesky] Failed to fetch thread for ${blueskyUri}:`, err.message);
    return { replies: [], likeCount: 0, repostCount: 0 };
  }
}

/**
 * Recursively flatten replies into a flat list with depth.
 */
function flattenReplies(replies, depth) {
  const result = [];
  for (const reply of replies) {
    if (reply.$type === 'app.bsky.feed.defs#threadViewPost' && reply.post) {
      result.push({
        uri: reply.post.uri,
        cid: reply.post.cid,
        text: reply.post.record?.text || '',
        createdAt: reply.post.record?.createdAt || reply.post.indexedAt,
        author: {
          handle: reply.post.author?.handle,
          displayName: reply.post.author?.displayName || reply.post.author?.handle,
          avatar: reply.post.author?.avatar,
          did: reply.post.author?.did,
        },
        likeCount: reply.post.likeCount || 0,
        depth,
      });
      if (reply.replies?.length > 0) {
        result.push(...flattenReplies(reply.replies, depth + 1));
      }
    }
  }
  return result;
}

/**
 * Convert an at:// URI to a bsky.app URL.
 */
function blueskyUriToUrl(uri, handle) {
  const parsed = parseAtUri(uri);
  if (!parsed || !handle) return null;
  return `https://bsky.app/profile/${handle}/post/${parsed.rkey}`;
}

/**
 * Like a Bluesky post on behalf of a user.
 */
export async function likeBlueskyPost(user, blueskyUri, blueskyCid) {
  if (!user.blueskyEnabled || !user.blueskyHandle || !user.blueskyAppPassword) {
    return null;
  }

  try {
    const agent = await createAgent(user);
    const result = await agent.like(blueskyUri, blueskyCid);
    console.log(`[bluesky] ${user.username} liked ${blueskyUri}`);
    return result.uri;
  } catch (err) {
    console.warn(`[bluesky] Like failed for ${user.username}:`, err.message);
    return null;
  }
}

/**
 * Unlike a Bluesky post on behalf of a user.
 */
export async function unlikeBlueskyPost(user, likeUri) {
  if (!user.blueskyEnabled || !user.blueskyHandle || !user.blueskyAppPassword) {
    return false;
  }

  try {
    const agent = await createAgent(user);
    const parsed = parseAtUri(likeUri);
    if (parsed) {
      await agent.deleteLike(likeUri);
      console.log(`[bluesky] ${user.username} unliked ${likeUri}`);
    }
    return true;
  } catch (err) {
    console.warn(`[bluesky] Unlike failed for ${user.username}:`, err.message);
    return false;
  }
}

/**
 * Post a reply to a Bluesky thread on behalf of a user.
 */
export async function replyOnBluesky(user, parentUri, parentCid, rootUri, rootCid, text) {
  if (!user.blueskyEnabled || !user.blueskyHandle || !user.blueskyAppPassword) {
    return null;
  }

  try {
    const agent = await createAgent(user);
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    const result = await agent.post({
      text: rt.text,
      facets: rt.facets,
      reply: {
        root: { uri: rootUri, cid: rootCid },
        parent: { uri: parentUri, cid: parentCid },
      },
      createdAt: new Date().toISOString(),
    });

    console.log(`[bluesky] ${user.username} replied on ${parentUri}`);
    return result.uri;
  } catch (err) {
    console.warn(`[bluesky] Reply failed for ${user.username}:`, err.message);
    return null;
  }
}
