import type { NextConfig } from "next";

const security = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@lethe/shared"],
  async headers() {
    return [{ source: "/:path*", headers: security }];
  },
  webpack(cfg) {
    // wallet libraries reference optional native modules unused in the browser
    cfg.resolve.fallback = {
      ...cfg.resolve.fallback,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
    };
    // the Base Account connector pulls in Coinbase's CDP SDK, whose optional x402 payment modules Lethe never uses
    cfg.resolve.alias = {
      ...cfg.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };
    // @lethe/shared uses explicit .ts import specifiers
    cfg.resolve.extensionAlias = { ".js": [".ts", ".js"], ".ts": [".ts"] };
    return cfg;
  },
};

export default config;
