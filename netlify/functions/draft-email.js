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

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "API key not configured" })
    };
  }

  const { client } = JSON.parse(event.body);

  const system = `You are Jessica, AI sales agent for Pinnacle CRM, drafting a personalized first response email for a luxury automotive dealership.

VOICE: Warm, genuine, excited. Like hearing from a trusted friend who sells the world's finest cars.

EMAIL RULES:
- Thank them genuinely for the opportunity to earn their business
- Express real excitement about their specific vehicle choice
- Create subtle urgency - vehicles like this move, but keep it classy
- ONE clear call to action - reply, call, or come in
- Short - 4-6 sentences max
- Sign off as Adam Russell, Luxury Sales Advisor, Pinnacle CRM, jessica@pinnaclecrm.ai

CRITICAL: Return ONLY a raw JSON object. Start with { and end with }. No markdown. No backticks. No explanation.

JSON format:
{"subject":"So glad you reached out, FIRSTNAME!","body":"full email text here","preview":"first sentence only"}`;

  const userMsg = `Draft a first response email for:
Name: ${client.first_name} ${client.last_name}
Vehicle: ${client.vehicle_of_interest || "luxury vehicle"}
Source: ${client.lead_source || "enquiry"}`;

  const payload = JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 1000,
    system: system,
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
          // Strip any markdown code blocks just in case
          text = text.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim();
          const emailData = JSON.parse(text);
          resolve({
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify(emailData)
          });
        } catch(e) {
          resolve({
            statusCode: 500,
            headers: { "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ error: "Parse error: " + e.message })
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
