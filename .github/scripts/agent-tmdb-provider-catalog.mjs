import fs from "node:fs";

const path = "src/components/what-to-watch-app.tsx";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(label, pattern, replacement) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Patch failed: ${label}`);
  source = next;
}

replaceOnce(
  "provider selector import",
  'import { useEffect, useRef, useState } from "react";\n',
  'import { useEffect, useRef, useState } from "react";\n\nimport { ProviderSelector } from "./provider-selector";\n',
);

replaceOnce(
  "remove hard-coded services",
  /\nconst services = \[[\s\S]*?\n\];\n\nconst moods:/,
  "\nconst moods:",
);

replaceOnce(
  "onboarding provider selector",
  /          <div className="service-grid">\n            \{services\.map\(\(service\) => \{[\s\S]*?          <\/div>\n          <div className="onboarding-actions">/,
  `          <ProviderSelector
            region={profile.region}
            selected={profile.subscriptions}
            onChange={(subscriptions) => onChange({ ...profile, subscriptions })}
          />
          <div className="onboarding-actions">`,
);

replaceOnce(
  "settings provider selector",
  /  if \(section === "services"\) return <SettingsSubpage title="Streaming services"[\s\S]*?<\/SettingsSubpage>;\n  if \(section === "friends"\)/,
  `  if (section === "services") return (
    <SettingsSubpage title="Streaming services" onBack={() => setSection("main")}>
      <p className="settings-intro">Availability is filtered for this profile only. The service catalog follows {profile.region}.</p>
      <ProviderSelector
        region={profile.region}
        selected={profile.subscriptions}
        onChange={(subscriptions) => onChange({ ...profile, subscriptions })}
        mode="list"
      />
    </SettingsSubpage>
  );
  if (section === "friends")`,
);

if (source.includes("const services =") || source.includes("services.map((service)")) {
  throw new Error("Patch left hard-coded provider data behind");
}

fs.writeFileSync(path, source);
