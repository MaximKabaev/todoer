import type { MetadataRoute } from "next";

// Home-screen install (iOS "Add to Home Screen", Android "Install app").
// The iOS icon itself comes from app/apple-icon.png; regenerate icons with scripts/render-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "todoer",
    short_name: "todoer",
    description: "Shared tasks for Maxim and German.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8fa",
    theme_color: "#f7f8fa",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
