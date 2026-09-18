import type { MetadataRoute } from "next";

import { launches } from "@/lib/site-data";

const baseUrl = "https://sportpad.fun";
const lastModified = new Date("2026-09-18T00:00:00.000Z");

export default function sitemap(): MetadataRoute.Sitemap {
  const pages: Array<{
    path: string;
    changeFrequency: "daily" | "weekly" | "monthly";
    priority: number;
  }> = [
    { path: "", changeFrequency: "daily", priority: 1 },
    { path: "/discover", changeFrequency: "daily", priority: 0.9 },
    { path: "/fan-tokens", changeFrequency: "weekly", priority: 0.8 },
    { path: "/matchday", changeFrequency: "daily", priority: 0.8 },
    { path: "/rewards", changeFrequency: "weekly", priority: 0.7 },
    { path: "/how-it-works", changeFrequency: "monthly", priority: 0.8 },
    { path: "/transparency", changeFrequency: "daily", priority: 0.8 },
    { path: "/learn", changeFrequency: "weekly", priority: 0.8 },
    { path: "/launch", changeFrequency: "monthly", priority: 0.6 },
    { path: "/sport", changeFrequency: "weekly", priority: 0.8 },
    { path: "/policy", changeFrequency: "monthly", priority: 0.7 },
  ];

  return [
    ...pages.map((page) => ({
      url: `${baseUrl}${page.path}`,
      lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...launches.map((launch) => ({
      url: `${baseUrl}/launches/${launch.slug}`,
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
