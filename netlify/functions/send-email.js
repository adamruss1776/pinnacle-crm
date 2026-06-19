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

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "RESEND_API_KEY not configured" })
    };
  }

  const { to, subject, html, from } = JSON.parse(event.body);

  const payload = JSON.stringify({
    from: from || "Pinnacle CRM <notifications@pinnaclecrm.ai>",
    to: Array.isArray(to) ? to : [to],
    subject,
    html
  });

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: 200,
              headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ success: true, id: parsed.id })
            });
          } else {
            resolve({
              statusCode: res.statusCode,
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ error: parsed.message || parsed.name || "Failed to send email" })
            });
          }
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
