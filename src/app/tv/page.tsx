import type { Metadata, Viewport } from "next";

import { WhatToWatchTv } from "@/components/tv/what-to-watch-tv";

export const metadata: Metadata = {
  title: "What to Watch for TV",
  description: "A remote-first, ten-foot version of What to Watch.",
};

// Fire OS reports a 960px CSS viewport for a 1920px television at 320 dpi.
// A fixed ten-foot canvas keeps the native WebView and desktop TV preview in
// the same coordinate system while still scaling down on smaller displays.
export const viewport: Viewport = {
  width: 1920,
  initialScale: 0.5,
  minimumScale: 0.5,
  maximumScale: 0.5,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#080807",
  colorScheme: "dark",
};

export default function TvPage() {
  return <WhatToWatchTv />;
}
