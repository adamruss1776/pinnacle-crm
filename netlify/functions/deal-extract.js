// Reads a DMS "deal recap" image (photo or screenshot) and returns structured
// deal fields as JSON. Powers the Bulk Import (zip) feature in My Numbers.
const https = require("https");

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
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
      body: JSON.stringify({ error: "API key not configured" }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); } catch (e) {
    return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Bad request" }) };
  }
  const { image, mediaType } = body;
  if (!image) {
    return { statusCode: 400, headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "No image provided" }) };
  }

  const system = `You read automotive DMS "deal recap" screens and return ONLY a raw JSON object — no markdown, no backticks, no commentary.

Extract these fields from the image:
{
 "date": "M/D/YYYY exactly as shown in Date Sold",
 "vehicle": "year make model trim of the PURCHASED vehicle (not the trade-in)",
 "type": "new or used (from New/Used field, lowercase)",
 "front": front gross as a number with no $ or commas (0 if blank),
 "back": back gross as a number with no $ or commas (0 if blank),
 "stock_num": "Stock Number of the purchased vehicle",
 "vin": "VIN of the purchased vehicle (17 chars)",
 "dms_id": "DMS ID exactly as shown, or empty string if not visible",
 "salesperson": "Salesperson name, or empty string if UNKNOWN SALESPERSON",
 "buyer": "customer/buyer name if shown in a title bar, else empty string"
}

Rules: Use the PURCHASED vehicle for vehicle/vin/stock, never the trade-in. Numbers only for front/back. If a field is genuinely not present, use an empty string (or 0 for front/back). Return the JSON object and nothing else.`;

  const payload = JSON.stringify({
    model: "claude-sonnet-4-5",
    max_tokens: 600,
    system: system,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType || "image/png", data: image } },
          { type: "text", text: "Extract the deal fields from this recap as JSON." },
        ],
      },
    ],
  });

  const result = await new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, data }));
      }
    );
    req.on("error", (e) => resolve({ status: 500, data: JSON.stringify({ error: e.message }) }));
    req.write(payload);
    req.end();
  });

  let fields = null, error = null;
  try {
    const parsed = JSON.parse(result.data);
    const text = parsed && parsed.content && parsed.content[0] && parsed.content[0].text;
    if (text) {
      const clean = text.trim().replace(/^```json\s*/i, "").replace(/```$/,"").trim();
      fields = JSON.parse(clean);
    } else {
      error = parsed.error ? (parsed.error.message || JSON.stringify(parsed.error)) : "No content returned";
    }
  } catch (e) { error = "Could not read that image: " + e.message; }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({ fields, error }),
  };
};
