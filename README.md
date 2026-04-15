# Pirate Social

A distributed photography social network built on RSS and individually hosted websites.

## Architecture

```
┌─────────────────────────────────────────────────┐
│              PIRATE SOCIAL HUB                   │
│  Express + Postgres (hosted on Railway)          │
│  • GitHub OAuth          • Feed aggregation      │
│  • Likes/Comments/Follows • Notifications (SSE)  │
│  • User directory        • Admin/moderation      │
└──────────────┬──────────────────┬───────────────┘
               │                  │
        ┌──────▼──────┐    ┌──────▼──────┐
        │  User Node  │    │  User Node  │
        │  (Astro)    │    │  (Astro)    │
        │  GitHub     │    │  GitHub     │
        │  Pages      │    │  Pages      │
        └─────────────┘    └─────────────┘
```

Every user owns their own website and content. Sites connect through extended RSS feeds and the central hub, creating a decentralized social experience for photographers.

## Project Structure

```
piratesocial/
├── hub/                      # Central server (Railway)
│   ├── src/
│   │   ├── index.js          # Express app entry
│   │   ├── middleware/       # Auth middleware
│   │   ├── routes/           # API endpoints
│   │   ├── services/         # Feed aggregator
│   │   └── utils/            # Notifications
│   ├── prisma/               # Database schema
│   ├── Dockerfile
│   └── railway.toml
│
└── node-template/            # User site template (GitHub Pages)
    ├── src/
    │   ├── components/       # Slideshow, Gallery, EXIF, Social
    │   ├── content/          # Posts, galleries, slideshows
    │   ├── layouts/          # Base layout
    │   ├── lib/              # Hub client, site config
    │   └── pages/            # Routes
    ├── public/admin/         # Decap CMS config
    └── .github/workflows/    # Auto-deploy + hub notification
```

## Getting Started

### Hub (you deploy once)

1. Create a GitHub OAuth App at github.com/settings/developers
2. Fork/push the `hub/` directory to a GitHub repo
3. Deploy to Railway:
   - Add a Postgres plugin
   - Set environment variables from `.env.example`
4. The hub is live at `your-hub.railway.app`

### User Nodes (each user)

1. Click "Use this template" on the node-template repo
2. Edit `src/lib/config.ts` with your details and the hub URL
3. Enable GitHub Pages (Settings → Pages → GitHub Actions)
4. Push — site auto-builds and notifies the hub
5. Go to `yoursite.github.io/admin` to manage content via CMS

## Features

### Photography
- EXIF data display (camera, lens, aperture, ISO, etc.)
- Photo galleries with lightbox
- Custom slideshows (fade, slide, zoom, Ken Burns)
- Image optimization via Astro/Sharp

### Social
- Follow other photographers
- Like and comment on posts
- Real-time notifications (SSE)
- Discover feed & user directory
- Full-text search across the network

### Content
- Markdown + MDX posts
- Decap CMS for browser-based editing
- Custom RSS with photo namespace
- Tags and categories

### Infrastructure
- User sites: free on GitHub Pages
- Hub: ~$5/month on Railway
- Auth: GitHub OAuth (free)
- No vendor lock-in — users own their content

## Custom RSS Namespace

Posts syndicate with extended metadata:

```xml
<rss xmlns:photo="https://piratesocial.github.io/ns/photo"
     xmlns:social="https://piratesocial.github.io/ns/social">
  <channel>
    <social:profilePhoto>...</social:profilePhoto>
    <social:bio>...</social:bio>
    <item>
      <photo:image>...</photo:image>
      <photo:exif>
        <photo:camera>Sony A7IV</photo:camera>
        <photo:aperture>2.8</photo:aperture>
      </photo:exif>
      <photo:gallery>
        <photo:image url="..." caption="..." />
      </photo:gallery>
    </item>
  </channel>
</rss>
```

## License

MIT
