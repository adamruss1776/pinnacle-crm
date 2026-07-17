// Scheduled wrapper — runs Jessica's cross-store scan every morning (see netlify.toml)
exports.handler = async () => {
  const res = await fetch(`${process.env.URL || "https://pinnaclecrm.ai"}/.netlify/functions/store-scan`);
  const body = await res.text();
  console.log("Daily store scan:", body.slice(0, 500));
  return { statusCode: 200, body: "ok" };
};
