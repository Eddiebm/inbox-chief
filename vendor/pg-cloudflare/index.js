/** Minimal stub so Workers bundles resolve require("pg-cloudflare"). */
class CloudflareSocket {
  constructor() {
    throw new Error(
      "pg-cloudflare TCP is unavailable in this build. Use MOCK_INTEGRATIONS=true or Hyperdrive.",
    );
  }
}
module.exports = { CloudflareSocket };
