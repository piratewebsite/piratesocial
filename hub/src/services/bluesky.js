import { AtpAgent, RichText } from '@atproto/api';

/**
 * Create an authenticated Bluesky agent for a user.
 */
async function createAgent(user) {
  const service = user.blueskyHandle?.includes('.')
    ? `https://${user.blueskyHandle.split('.').slice(1).join('.') === 'bsky.social' ? 'bsky.social' : 'bsky.social'}`
    : 'https://bsky.social';

  const agent = new AtpAgent({ service: 'https://bsky.social' });
  await agent.login({
    identifier: user.blueskyHandle,
    password: user.blueskyAppPassword,
  });
  return agent;
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
          record.embed = {
            $type: 'app.bsky.embed.images',
            images: [
              {
                alt: post.title || 'Photo',
                image: uploaded.data.blob,
                aspectRatio: undefined, // Could extract from EXIF later
              },
            ],
          };
        }
      } catch (imgErr) {
        console.warn(`[bluesky] Image upload failed for "${post.title}":`, imgErr.message);
        // Fall back to external embed (link card) instead
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
