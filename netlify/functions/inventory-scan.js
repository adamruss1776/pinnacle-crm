const https = require("https");

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "API key not configured" })
    };
  }

  const { stores, inventory, clientInterests } = JSON.parse(event.body);

  const totalVehicles = stores.reduce((t, s) => t + (inventory[s] || []).length, 0);

  const storeSummary = stores.map(store => {
    const vehicles = inventory[store] || [];
    const aging = vehicles.filter(v => v.daysListed !== null && v.daysListed > 90).length;
    const avgPrice = vehicles.length > 0
      ? Math.round(vehicles.reduce((s, v) => s + (Number(v.price) || 0), 0) / vehicles.length)
      : 0;
    return `${store}: ${vehicles.length} vehicles${aging > 0 ? `, ${aging} aging 90+ days` : ''}${avgPrice > 0 ? `, avg $${avgPrice.toLocaleString()}` : ''}`;
  }).join('\n');

  const system = `You are Jessica, Pinnacle CRM's AI inventory specialist for a luxury automotive dealership group with 7 Florida locations. Generate a concise daily inventory scan report. Focus on: aging inventory (90+ days on lot), stocking gaps, pricing opportunities, and client-vehicle matches.

Return ONLY raw JSON (no backticks, no markdown):
{"summary":"2-3 sentence executive overview","alerts":[{"store":"store name","type":"aging|low_stock|pricing|opportunity","message":"specific actionable alert"}],"recommendations":["specific recommendation 1","specific recommendation 2","specific recommendation 3"],"totalVehicles":0}`;

  const userMsg = `Daily inventory scan — ${new Date().toLocaleDateString()}:

${storeSummary}

Total inventory: ${totalVehicles} vehicles
Active client vehicle interests: ${(clientInterests || []).slice(0, 12).join(', ') || 'None recorded'}

Generate a concise daily scan report. Be specific and actionable.`;

  const payload = JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 900,
    system,
    messages: [{ role: "user", content: userMsg }]
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          let text = parsed.content?.[0]?.text || "{}";
          text = text.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
          const report = JSON.parse(text);
          resolve({
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ ...report, totalVehicles })
          });
        } catch(e) {
          resolve({
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Parse error: " + e.message, summary: "Scan completed but report could not be parsed.", alerts: [], recommendations: [], totalVehicles })
          });
        }
      });
    });

    req.on("error", (err) => {
      resolve({
        statusCode: 500,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: err.message })
      });
    });

    req.write(payload);
    req.end();
  });
};
