import type { MetadataRoute } from 'next';

// Makes the app installable. iOS only delivers web push to home-screen apps.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Panorist',
    short_name: 'Panorist',
    description: 'Personalized news briefings, delivered on your schedule.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f3ec',
    theme_color: '#f7f3ec',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
