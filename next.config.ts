import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@googleapis/gmail", "google-auth-library", "postal-mime"],
};

export default config;
