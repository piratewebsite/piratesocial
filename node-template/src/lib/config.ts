import settings from '../data/settings.json';

const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

/** Prefix a root-relative path with the base URL */
export function withBase(path: string): string {
  if (!path.startsWith('/') || path.startsWith(base + '/')) return path;
  return `${base}${path}`;
}

/** Site-wide configuration — edit via /admin or settings.json */
export const siteConfig = {
  title: settings.title || 'My Photo Site',
  description: settings.description || 'A photography site on the Pirate Social network',
  author: settings.author || 'Photographer',
  bio: settings.bio || 'I take photos of things.',
  avatar: withBase(settings.avatar || '/images/avatar.jpg'),
  location: settings.location || '',
  camera: settings.camera || '',
  siteUrl: import.meta.env.SITE || (settings.github ? `https://${settings.github}.github.io` : ''),
  hubUrl: 'https://piratesocial-hub-production.up.railway.app',
  social: {
    github: settings.github || '',
    instagram: settings.instagram || '',
    mastodon: settings.mastodon || '',
  },
};
