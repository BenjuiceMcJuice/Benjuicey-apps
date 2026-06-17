/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // GitHub Pages hosts at /repo-name, so set basePath when deploying there.
  // Leave unset for Vercel or local dev.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  trailingSlash: true,
  images: { unoptimized: true },
}

export default nextConfig
