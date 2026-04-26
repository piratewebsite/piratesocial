// Dynamic Decap CMS config endpoint.
// Reads the base YAML from src/lib/decap-config.yml and injects
// optional Cloudinary media_library config if the user has enabled it
// in Site Settings → Cloudinary Media Library.
import baseYaml from '../../lib/decap-config.yml?raw';
import settings from '../../content/settings.json';

interface CloudinarySettings {
  enabled?: boolean;
  cloudName?: string;
  apiKey?: string;
}

export async function GET() {
  let yaml: string = baseYaml;

  const cloudinary = (settings as { cloudinary?: CloudinarySettings }).cloudinary;
  if (cloudinary?.enabled && cloudinary.cloudName && cloudinary.apiKey) {
    const mediaBlock = [
      'media_library:',
      '  name: cloudinary',
      '  config:',
      `    cloud_name: ${cloudinary.cloudName}`,
      `    api_key: ${cloudinary.apiKey}`,
      '',
    ].join('\n');

    // Inject after logo_url line, before collections
    yaml = yaml.replace(/(logo_url:[^\n]*\n)/, `$1\n${mediaBlock}`);
  }

  return new Response(yaml, {
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
