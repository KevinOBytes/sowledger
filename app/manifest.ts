import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Billabled Workforce Intelligence",
    short_name: "Billabled",
    description: "Schedule work, track live timers, log completed work, and export billable proof.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f7f2ea",
    theme_color: "#163c36",
    icons: [
      {
        src: "/logo.png",
        sizes: "256x256",
        type: "image/png",
      },
    ],
  };
}
