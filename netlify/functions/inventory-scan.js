const https = require("https");

// Deterministic report built entirely from the data we already have.
// Used as a guaranteed fallback so the scan NEVER fails, even if the AI
// call errors, times out, or the API key is missing.
function buildFallback(stores, inventory, clientInterests, totalVehicles) {
  const alerts = [];
  const recommendations = [];
  let agingTotal = 0;
  const perStore = [];

  stores.forEach(function (store) {
    const vehicles = inventory[store] || [];
    const aging = vehicles.filter(function (v) {
      return v && v.daysListed !== null && v.daysListed !== undefined && Number(v.daysListed) > 90;
    });
    agingTotal += aging.length;
    const prices = vehicles.map(function (v) { return Number(v && v.price) || 0; }).filter(function (p) { return p > 0; });
    const avg = prices.length ? Math.round(prices.reduce(function (s, p) { return s + p; }, 0) / prices.length) : 0;
    perStore.push({ store: store, count: vehicles.length, aging: aging.length, avg: avg });
    if (aging.length > 0) {
      alerts.push({
        store: store,
        type: "aging",
        message: aging.length + " vehicle" + (aging.length > 1 ? "s" : "") + " on the lot 90+ days — consider a price adjustment or promotion."
      });
    }
    if (vehicles.length === 0) {
      alerts.push({ store: store, type: "low_stock", message: "No inventory currently recorded for this location." });
    }
  });

  // Match active client interests against current inventory.
  const interests = (clientInterests || []).filter(Boolean);
  const allVehicles = [];
  stores.forEach(function (store) {
    (inventory[store] || []).forEach(function (v) {
      if (v && v.vehicle) allVehicles.push({ store: store, vehicle: String(v.vehicle) });
    });
  });
  let matchCount = 0;
  interests.slice(0, 12).forEach(function (interest) {
    const words = String(interest).toLowerCase().split(/\s+/).filter(function (w) { return w.length > 2; });
    const hit = allVehicles.find(function (v) {
      const vl = v.vehicle.toLowerCase();
      return words.some(function (w) { return vl.indexOf(w) !== -1; });
    });
    if (hit) {
      matchCount++;
      recommendations.push('Client interest "' + interest + '" matches ' + hit.vehicle + " at " + hit.store + " — reach out today.");
    }
  });

  const busiest = perStore.slice().sort(function (a, b) { return b.count - a.count; })[0];
  if (recommendations.length === 0) {
    if (agingTotal > 0) {
      recommendations.push("Prioritize the " + agingTotal + " aging unit" + (agingTotal > 1 ? "s" : "") + " for pricing review this week.");
    }
    if (busiest && busiest.count > 0) {
      recommendations.push(busiest.store + " holds the most inventory (" + busiest.count + " units) — a good source for cross-store client matches.");
    }
    recommendations.push("Record vehicle interests on your active clients to unlock automatic inventory matches.");
  }

  const summary = "Scanned " + totalVehicles + " vehicle" + (totalVehicles === 1 ? "" : "s") + " across " +
    stores.length + " location" + (stores.length === 1 ? "" : "s") + ". " +
    (agingTotal > 0 ? agingTotal + " unit" + (agingTotal > 1 ? "s are" : " is") + " aging past 90 days. " : "No aging concerns over 90 days. ") +
    (matchCount > 0 ? matchCount + " client interest" + (matchCount > 1 ? "s match" : " matches") + " current inventory." : "No client-inventory matches today.");

  return { summary: summary, alerts: alerts, recommendations: recommendations.slice(0, 5), totalVehicles: totalVehicles };
}

exports.handler = async function (event) {
  const CORS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  // Parse input defensively — never crash the function.
  let stores = [], inventory = {}, clientInterests = [];
  try {
    const b = JSON.parse(event.body || "{}");
    stores = Array.isArray(b.stores) ? b.stores : [];
    inventory = b.inventory && typeof b.inventory === "object" ? b.inventory : {};
    clientInterests = Array.isArray(b.clientInterests) ? b.clientInterests : [];
  } catch (e) {
    stores = []; inventory = {}; clientInterests = [];
  }

  const totalVehicles = stores.reduce(function (t, s) { return t + ((inventory[s] || []).length); }, 0);
  const fallback = buildFallback(stores, inventory, clientInterests, totalVehicles);

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  // No key? Return the deterministic report — still a complete, useful scan.
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify(fallback) };
  }

  const storeSummary = stores.map(function (store) {
    const vehicles = inventory[store] || [];
    const aging = vehicles.filter(function (v) { return v && v.daysListed !== null && v.daysListed !== undefined && Number(v.daysListed) > 90; }).length;
    const prices = vehicles.map(function (v) { return Number(v && v.price) || 0; }).filter(function (p) { return p > 0; });
    const avgPrice = prices.length ? Math.round(prices.reduce(function (s, p) { return s + p; }, 0) / prices.length) : 0;
    return store + ": " + vehicles.length + " vehicles" + (aging > 0 ? ", " + aging + " aging 90+ days" : "") + (avgPrice > 0 ? ", avg $" + avgPrice.toLocaleString() : "");
  }).join("\n");

  const system = "You are Jessica, Pinnacle CRM's AI inventory specialist for a luxury automotive dealership group with locations across Florida and partner stores nationwide. Generate a concise daily inventory scan report. Focus on: aging inventory (90+ days on lot), stocking gaps, pricing opportunities, and client-vehicle matches.\n\nReturn ONLY raw JSON (no backticks, no markdown):\n{\"summary\":\"2-3 sentence executive overview\",\"alerts\":[{\"store\":\"store name\",\"type\":\"aging|low_stock|pricing|opportunity\",\"message\":\"specific actionable alert\"}],\"recommendations\":[\"specific recommendation 1\",\"specific recommendation 2\",\"specific recommendation 3\"],\"totalVehicles\":0}";

  const userMsg = "Daily inventory scan — " + new Date().toLocaleDateString() + ":\n\n" +
    storeSummary + "\n\nTotal inventory: " + totalVehicles + " vehicles\n" +
    "Active client vehicle interests: " + ((clientInterests || []).slice(0, 12).join(", ") || "None recorded") +
    "\n\nGenerate a concise daily scan report. Be specific and actionable.";

  const payload = JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 900,
    system: system,
    messages: [{ role: "user", content: userMsg }]
  });

  const aiResult = await new Promise(function (resolve) {
    let settled = false;
    const done = function (val) { if (!settled) { settled = true; resolve(val); } };

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
    }, function (res) {
      let data = "";
      res.on("data", function (chunk) { data += chunk; });
      res.on("end", function () {
        try {
          const parsed = JSON.parse(data);
          let text = (parsed && parsed.content && parsed.content[0] && parsed.content[0].text) || "";
          if (!text) { done(null); return; }
          text = text.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
          const report = JSON.parse(text);
          if (!report || !report.summary) { done(null); return; }
          done(report);
        } catch (e) { done(null); }
      });
    });

    req.setTimeout(8000, function () { try { req.destroy(); } catch (e) {} done(null); });
    req.on("error", function () { done(null); });
    req.write(payload);
    req.end();
  });

  let body;
  if (aiResult && aiResult.summary) {
    body = {
      summary: aiResult.summary,
      alerts: Array.isArray(aiResult.alerts) ? aiResult.alerts : fallback.alerts,
      recommendations: Array.isArray(aiResult.recommendations) && aiResult.recommendations.length ? aiResult.recommendations : fallback.recommendations,
      totalVehicles: totalVehicles
    };
  } else {
    body = fallback;
  }

  return { statusCode: 200, headers: CORS, body: JSON.stringify(body) };
};
