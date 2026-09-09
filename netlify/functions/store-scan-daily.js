// Scheduled wrapper - runs Jessica's cross-store scan every morning (see netlify.toml).
// Calls the scan handler directly instead of fetching our own public URL. The old version
// went out over the internet to https://pinnaclecrm.ai and stopped working the moment that
// domain's DNS broke; this version has no dependency on the custom domain at all.
const scan = require("./store-scan");

exports.handler = async () => {
    try {
          const res = await scan.handler({ queryStringParameters: {} });
          console.log("Daily store scan:", String(res && res.body).slice(0, 600));
          return { statusCode: 200, body: "ok" };
    } catch (e) {
          console.error("Daily store scan failed:", e);
          return { statusCode: 500, body: "scan failed: " + String(e) };
    }
};
