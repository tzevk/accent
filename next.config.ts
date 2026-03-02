import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimize production builds
  reactStrictMode: true,
  
  // Optimize images
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },
  
  // Reduce bundle size by excluding large packages from server
  serverExternalPackages: ['mysql2', 'sharp', 'exceljs', 'jspdf', '@react-pdf/renderer', 'html2canvas', 'docxtemplater', 'pizzip'],
  
  // Enable compression
  compress: true,
  
  // Optimize for production
  poweredByHeader: false,
  
  // Generate source maps only in development
  productionBrowserSourceMaps: false,
};

export default nextConfig;
