const https = require("https");

const EMAIL_SYSTEM_PROMPT = `You are Jessica, AI sales agent for Pinnacle CRM, drafting a personalized email on behalf of a luxury automotive sales advisor.

VOICE: Warm, genuine, excited — like hearing from a trusted friend who happens to sell the world's finest cars. Never corporate, never templated-sounding.

EMAIL RULES:
- Subject line is always: So glad you reached out, [First Name]!
- Opening: Thank them genuinely for the opportunity to earn their business
- Second line: Express real excitement about the specific vehicle they chose — make them feel like they picked something special
- Middle: Create subtle urgency — vehicles like this move, but keep it classy not pushy
- Call to action: ONE clear ask — reply, call, or come in. Make it feel easy and exciting
- Closing: Warm, personal, professional
- Length: Short. 4-6 sentences max. Luxury buyers don't read walls of text.
- Tone: Like you've known them for years. Calm, confident, warm.

SIGN-OFF FORMAT (always end with exactly this):
Warmly,

Adam Russell
Luxury Sales Advisor | Pinnacle CRM
📱 [phone number if provided]
✉️ [email if provided]
PinnacleCRM.ai

OUTPUT FORMAT: Return a JSON object with exactly these fields:
{
  "subject": "So glad you reached out, [First Name]!",
  "body": "the full email body text",
  "preview": "first sentence only for preview"
}
Return ONLY the JSON. No explanation, no markdown, no backticks.`;

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

  const userPrompt = `Draft a first response email for this lead:
Name: ${client.first_name} ${client.last_name}
Vehicle of Interest: ${client.vehicle_of_interest || "luxury vehicle"}
Lead Source: ${client.lead_source || "enquiry"}
Notes: ${client.notes || "none"}
Advisor phone: to be added
Advisor email: jessica@pinnaclecrm.ai`;

  const payload = JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 1000,
    system: EMAIL_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }]
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
          const text = parsed.content?.[0]?.text || "{}";
          const emailData = JSON.parse(text);
          resolve({
            statusCode: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            },
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
