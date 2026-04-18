/**
 * Provisioning service — creates a user's node site repo via GitHub API.
 *
 * Flow:
 * 1. Fetch the node-template tree from the piratesocial monorepo
 * 2. Create a new repo: {username}.github.io
 * 3. Push all template files (customised) in a single commit
 * 4. Enable GitHub Pages with Actions source
 */

const TEMPLATE_OWNER = 'piratewebsite';
const TEMPLATE_REPO = 'piratesocial';
const TEMPLATE_PATH = 'node-template';
const HUB_URL = process.env.HUB_URL || 'https://piratesocial.app';

// Files/dirs to skip when copying the template
const SKIP_PATTERNS = [
  '.astro/',
  'dist/',
  'node_modules/',
  'package-lock.json',
  '.DS_Store',
  'src/content/posts/crosspost-test-from-social.md',
  'src/content/posts/sample.jpg',
  'src/content/galleries/test.md',
];

function shouldSkip(path) {
  return SKIP_PATTERNS.some(p => path.startsWith(p) || path === p);
}

async function ghApi(endpoint, token, opts = {}) {
  const url = endpoint.startsWith('http')
    ? endpoint
    : `https://api.github.com${endpoint}`;
  const method = opts.method || 'GET';
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const scopes = res.headers.get('x-oauth-scopes');
    const text = await res.text();
    console.error(`[ghApi] ${method} ${endpoint} → ${res.status} (scopes: ${scopes})`);
    console.error(`[ghApi] Response: ${text.slice(0, 300)}`);
    throw new Error(`GitHub API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Fetch the file tree for node-template from the piratesocial repo.
 */
async function fetchTemplateTree(token) {
  // Get the default branch SHA
  const repo = await ghApi(`/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}`, token);
  const branch = repo.default_branch || 'main';

  // Get the full tree recursively
  const refData = await ghApi(
    `/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/git/ref/heads/${branch}`,
    token
  );
  const treeSha = refData.object.sha;

  const tree = await ghApi(
    `/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/git/trees/${treeSha}?recursive=1`,
    token
  );

  // Filter to node-template/ prefix and remove the prefix
  const prefix = `${TEMPLATE_PATH}/`;
  return tree.tree
    .filter(item => item.path.startsWith(prefix) && item.type === 'blob')
    .map(item => ({
      path: item.path.slice(prefix.length),
      sha: item.sha,
      size: item.size,
      mode: item.mode,
    }))
    .filter(item => !shouldSkip(item.path));
}

/**
 * Fetch a file's content from the template repo.
 */
async function fetchFileContent(sha, token) {
  const blob = await ghApi(
    `/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/git/blobs/${sha}`,
    token
  );
  return {
    content: blob.content,       // base64
    encoding: blob.encoding,
  };
}

/**
 * Customise file content for the user's settings.
 */
function customiseFile(path, contentBase64, settings) {
  // Only customise text files we know about
  const textFiles = [
    'src/data/settings.json',
    'astro.config.mjs',
    'public/admin/config.yml',
  ];

  if (!textFiles.includes(path)) return contentBase64;

  let text = Buffer.from(contentBase64, 'base64').toString('utf-8');

  const { username, displayName, bio, location, camera, siteTitle, repoName } = settings;
  const isUserSite = repoName === `${username}.github.io`;
  const siteUrl = isUserSite
    ? `https://${repoName}`
    : `https://${username}.github.io/${repoName}`;
  const fullRepoName = `${username}/${repoName}`;

  if (path === 'src/data/settings.json') {
    const current = JSON.parse(text);
    current.github = username;
    current.author = displayName || username;
    current.bio = bio || 'I take photos of things.';
    current.location = location || '';
    current.camera = camera || '';
    current.title = siteTitle || `${displayName || username}'s Photos`;
    current.description = 'A photography site on the Pirate Social network';
    current.avatar = current.avatar || '/images/avatar.jpg';
    text = JSON.stringify(current, null, 2) + '\n';
  }

  if (path === 'astro.config.mjs') {
    text = text.replace(
      /site:\s*(?:process\.env\.SITE_URL\s*\|\|\s*)?'[^']*'/,
      `site: process.env.SITE_URL || '${siteUrl}'`
    );
    // For project sites, set a default base path
    if (!isUserSite) {
      text = text.replace(
        /const base = process\.env\.BASE_PATH \|\| undefined/,
        `const base = process.env.BASE_PATH || '/${repoName}'`
      );
    }
  }

  if (path === 'public/admin/config.yml') {
    text = text.replace(/repo:\s*.+/, `repo: ${fullRepoName}`);
    text = text.replace(/site_url:\s*.+/, `site_url: ${siteUrl}`);
    text = text.replace(/display_url:\s*.+/, `display_url: ${siteUrl}`);
    text = text.replace(
      /base_url:\s*.+/,
      `base_url: ${HUB_URL}`
    );
    // For project sites, prefix public_folder with the base path
    if (!isUserSite) {
      text = text.replace(/public_folder:\s*\/images/, `public_folder: /${repoName}/images`);
    }
  }

  return Buffer.from(text).toString('base64');
}

/**
 * Create the user's repo, push all template files, enable GitHub Pages.
 */
export async function provisionNode(user, settings) {
  const token = user.githubToken;
  if (!token) throw new Error('No GitHub token — re-authenticate');

  const repoName = settings.repoName || `${user.username}.github.io`;
  const isUserSite = repoName === `${user.username}.github.io`;
  const siteUrl = isUserSite
    ? `https://${repoName}`
    : `https://${user.username}.github.io/${repoName}`;

  console.log(`[provision] Starting for ${user.username} → ${repoName}`);

  // Check token scopes
  const scopeCheck = await fetch('https://api.github.com/user', {
    headers: { Authorization: `token ${token}` },
  });
  console.log(`[provision] Token scopes: ${scopeCheck.headers.get('x-oauth-scopes')}`);

  // 1. Create the repo (or check if it exists)
  let repoExists = false;
  try {
    await ghApi(`/repos/${user.username}/${repoName}`, token);
    repoExists = true;
    console.log(`[provision] Repo ${repoName} already exists`);
  } catch {
    // Repo doesn't exist — create it with auto_init so Git Data API works
    await ghApi('/user/repos', token, {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        description: `My photography site on Pirate Social`,
        homepage: siteUrl,
        auto_init: true,
        private: false,
      }),
    });
    console.log(`[provision] Created repo ${repoName}`);
    // Poll until the repo is initialized (main branch exists)
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 1500));
      try {
        await ghApi(`/repos/${user.username}/${repoName}/git/ref/heads/main`, token);
        console.log(`[provision] Repo ready after ${attempt + 1} attempts`);
        break;
      } catch {
        console.log(`[provision] Waiting for repo init (attempt ${attempt + 1})...`);
      }
    }
  }

  // 2. Fetch the template file tree
  console.log(`[provision] Fetching template tree...`);
  const templateFiles = await fetchTemplateTree(token);
  console.log(`[provision] Found ${templateFiles.length} template files`);

  // 3. Create blobs for all files (with customisation)
  console.log(`[provision] Creating blobs...`);
  const treeEntries = [];

  // Process files in batches to avoid rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < templateFiles.length; i += BATCH_SIZE) {
    const batch = templateFiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (file) => {
        const { content: rawContent } = await fetchFileContent(file.sha, token);
        const customised = customiseFile(file.path, rawContent, {
          username: user.username,
          repoName,
          displayName: settings.displayName || user.displayName || user.username,
          bio: settings.bio || user.bio || '',
          location: settings.location || '',
          camera: settings.camera || '',
          siteTitle: settings.siteTitle || '',
        });

        // Create blob in user's repo
        const blob = await ghApi(`/repos/${user.username}/${repoName}/git/blobs`, token, {
          method: 'POST',
          body: JSON.stringify({ content: customised, encoding: 'base64' }),
        });

        return {
          path: file.path,
          mode: file.mode,
          type: 'blob',
          sha: blob.sha,
        };
      })
    );
    treeEntries.push(...results);
  }

  // 4. Create a new tree with all template files
  // Get current tree SHA as base_tree (needed for repos initialized with auto_init)
  let baseTreeSha;
  try {
    const headRef = await ghApi(
      `/repos/${user.username}/${repoName}/git/ref/heads/main`,
      token
    );
    const headCommit = await ghApi(
      `/repos/${user.username}/${repoName}/git/commits/${headRef.object.sha}`,
      token
    );
    baseTreeSha = headCommit.tree.sha;
  } catch (e) {
    console.log(`[provision] Could not get base tree: ${e.message}`);
  }

  console.log(`[provision] Creating tree with ${treeEntries.length} files (base: ${baseTreeSha || 'none'})...`);
  console.log(`[provision] Sample entry:`, JSON.stringify(treeEntries[0]));
  const treePayload = { tree: treeEntries };
  if (baseTreeSha) treePayload.base_tree = baseTreeSha;

  const newTree = await ghApi(`/repos/${user.username}/${repoName}/git/trees`, token, {
    method: 'POST',
    body: JSON.stringify(treePayload),
  });

  // 5. Get parent commit SHA (always try — auto_init creates main branch)
  let parentShas = [];
  try {
    const refData = await ghApi(
      `/repos/${user.username}/${repoName}/git/ref/heads/main`,
      token
    );
    parentShas = [refData.object.sha];
  } catch {
    // No main branch yet — orphan commit
  }

  const commit = await ghApi(`/repos/${user.username}/${repoName}/git/commits`, token, {
    method: 'POST',
    body: JSON.stringify({
      message: '🏴‍☠️ Initialize Pirate Social node',
      tree: newTree.sha,
      parents: parentShas,
    }),
  });

  // 6. Update or create the main branch ref
  if (parentShas.length > 0) {
    await ghApi(`/repos/${user.username}/${repoName}/git/refs/heads/main`, token, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: true }),
    });
  } else {
    await ghApi(`/repos/${user.username}/${repoName}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({ ref: 'refs/heads/main', sha: commit.sha }),
    });
  }

  console.log(`[provision] Pushed ${treeEntries.length} files`);

  // 8. Enable GitHub Pages (Actions source)
  // For *.github.io repos, GitHub auto-enables Pages with legacy/branch source.
  // We need to POST (create) or PUT (update) to set build_type to 'workflow'.
  try {
    await ghApi(`/repos/${user.username}/${repoName}/pages`, token, {
      method: 'POST',
      body: JSON.stringify({
        build_type: 'workflow',
      }),
    });
    console.log(`[provision] GitHub Pages enabled (created)`);
  } catch (err) {
    // Pages likely already exists (auto-enabled for *.github.io repos) — update it
    try {
      await ghApi(`/repos/${user.username}/${repoName}/pages`, token, {
        method: 'PUT',
        body: JSON.stringify({
          build_type: 'workflow',
        }),
      });
      console.log(`[provision] GitHub Pages updated to workflow build`);
    } catch (err2) {
      console.warn(`[provision] Could not configure Pages (non-fatal):`, err2.message);
    }
  }

  console.log(`[provision] ✅ Done! Site will be at ${siteUrl}`);

  return {
    repoUrl: `https://github.com/${user.username}/${repoName}`,
    siteUrl,
    repoCreated: !repoExists,
    filesCount: treeEntries.length,
  };
}
