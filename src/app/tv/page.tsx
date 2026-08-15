import type { Metadata } from "next";

import { WhatToWatchTv } from "@/components/tv/what-to-watch-tv";

export const metadata: Metadata = {
  title: "What to Watch for TV",
  description: "A remote-first, ten-foot version of What to Watch.",
};

export default function TvPage() {
  return <WhatToWatchTv />;
}
