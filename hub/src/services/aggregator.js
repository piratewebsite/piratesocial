import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => ['item', 'entry'].includes(name),
});

/**
 * Aggregate all registered user feeds into the database.
 */
export async function aggregateAllFeeds(prisma) {
  const users = await prisma.user.findMany({
    where: { feedUrl: { not: null }, isBanned: false },
    select: {
      id: true, username: true, feedUrl: true,
      blueskyHandle: true, blueskyAppPassword: true,
      blueskyEnabled: true, blueskyDid: true,
    },
  });

  console.log(`[aggregator] Processing ${users.length} feeds`);
  let totalNew = 0;

  // Process feeds in batches of 10 to avoid overwhelming
  for (let i = 0; i < users.length; i += 10) {
    const batch = users.slice(i, i + 10);
    const results = await Promise.allSettled(
      batch.map(user => aggregateUserFeed(prisma, user))
    );
    for (const result of results) {
      if (result.status === 'fulfilled') totalNew += result.value;
    }
  }

  console.log(`[aggregator] Total new posts: ${totalNew}`);
  return totalNew;
}

/**
 * Fetch and process a single user's RSS feed.
 */
export async function aggregateUserFeed(prisma, user) {
  if (!user.feedUrl) return 0;

  let xml;
  try {
    const response = await fetch(user.feedUrl, {
      headers: { 'User-Agent': 'PirateSocial-Hub/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.warn(`[aggregator] Feed fetch failed for ${user.username}: ${response.status}`);
      return 0;
    }
    xml = await response.text();
  } catch (err) {
    console.warn(`[aggregator] Feed fetch error for ${user.username}: ${err.message}`);
    return 0;
  }

  let feed;
  try {
    feed = parser.parse(xml);
  } catch (err) {
    console.warn(`[aggregator] Feed parse error for ${user.username}: ${err.message}`);
    return 0;
  }

  // Support both RSS 2.0 and Atom
  const items = feed?.rss?.channel?.item || feed?.feed?.entry || [];
  let newCount = 0;

  for (const item of items) {
    const guid = item.guid?.['#text'] || item.guid || item.id || item.link;
    if (!guid) continue;

    // Check if post already exists
    const existing = await prisma.post.findUnique({ where: { guid } });

    // Extract photo-specific fields (custom RSS namespace)
    const imageUrl = extractImageUrl(item);
    const exifData = extractExifData(item);
    const gallery = extractGallery(item);
    const tags = extractTags(item);

    if (existing) {
      // Update existing post if key fields changed
      const updates = {};
      if (imageUrl && imageUrl !== existing.imageUrl) updates.imageUrl = imageUrl;
      if (item.title && item.title !== existing.title) updates.title = item.title;
      const desc = item.description || item.summary || '';
      if (desc && desc !== existing.description) updates.description = desc;
      if (Object.keys(updates).length > 0) {
        await prisma.post.update({ where: { guid }, data: updates });
      }
      continue;
    }

    try {
      const newPost = await prisma.post.create({
        data: {
          guid,
          userId: user.id,
          title: item.title || 'Untitled',
          description: item.description || item.summary || '',
          content: item['content:encoded'] || item.content?.['#text'] || item.content || '',
          link: item.link?.['@_href'] || item.link || '',
          pubDate: parseDate(item.pubDate || item.published || item.updated),
          imageUrl,
          thumbnailUrl: item['photo:thumbnail'] || item['media:thumbnail']?.['@_url'] || null,
          exifData,
          gallery,
          tags,
        },
      });
      newCount++;

      // Cross-post to Bluesky if enabled
      if (user.blueskyEnabled) {
        try {
          const { crossPostToBluesky } = await import('./bluesky.js');
          const bskyUri = await crossPostToBluesky(user, newPost);
          if (bskyUri) {
            await prisma.post.update({
              where: { id: newPost.id },
              data: { blueskyUri: bskyUri },
            });
          }
        } catch (bskyErr) {
          console.warn(`[aggregator] Bluesky cross-post failed for "${guid}":`, bskyErr.message);
        }
      }
    } catch (err) {
      console.warn(`[aggregator] Failed to save post "${guid}":`, err.message);
    }
  }

  return newCount;
}

function extractImageUrl(item) {
  // Try custom photo namespace first, then media:content, then enclosure
  return (
    item['photo:image'] ||
    item['media:content']?.['@_url'] ||
    (item.enclosure?.['@_type']?.startsWith('image/') ? item.enclosure['@_url'] : null) ||
    null
  );
}

function extractExifData(item) {
  const exif = item['photo:exif'];
  if (!exif) return null;

  return {
    camera: exif['photo:camera'] || null,
    lens: exif['photo:lens'] || null,
    focalLength: exif['photo:focalLength'] || null,
    aperture: exif['photo:aperture'] || null,
    shutterSpeed: exif['photo:shutterSpeed'] || null,
    iso: exif['photo:iso'] || null,
    dateTaken: exif['photo:dateTaken'] || null,
    gps: exif['photo:gps'] || null,
  };
}

function extractGallery(item) {
  const gallery = item['photo:gallery'];
  if (!gallery) return null;

  // Gallery can be an array of photo:image elements
  const images = Array.isArray(gallery['photo:image'])
    ? gallery['photo:image']
    : gallery['photo:image']
      ? [gallery['photo:image']]
      : [];

  return images.map(img => ({
    url: typeof img === 'string' ? img : img['@_url'] || img['#text'] || img,
    caption: img['@_caption'] || null,
    alt: img['@_alt'] || null,
  }));
}

function extractTags(item) {
  // Try category elements, then custom tags
  const categories = item.category;
  if (!categories) return [];

  const cats = Array.isArray(categories) ? categories : [categories];
  return cats.map(c => (typeof c === 'string' ? c : c['#text'] || c).toLowerCase().trim()).filter(Boolean);
}

function parseDate(dateStr) {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}
