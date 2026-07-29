// Jessica's morning report — emailed daily at 7am ET.
// Sections: new arrivals across the group, price drops (7 days), client matches,
// and real headlines pulled live from automotive industry feeds.
const SUPABASE_URL = "https://ozrybagfwnsaakjamztl.supabase.co";
const SUPABASE_KEY = "sb_publishable_hkoTQVteawqO4YAbj17F6Q_PmshLH50";
const REPORT_TO = process.env.REPORT_TO || "adam@pinnaclecrm.ai";
const HOME_STORE = "Fields Motorcars Orlando";

// Industry feeds. Any that fail are skipped silently — the report still sends.
const FEEDS = [
  { name: "Carscoops", url: "https://www.carscoops.com/feed/", bucket: "market" },
  { name: "Motor1", url: "https://www.motor1.com/rss/news/", bucket: "market" },
  { name: "Autoblog", url: "https://www.autoblog.com/rss.xml", bucket: "market" },
  { name: "Auto Remarketing", url: "https://www.autoremarketing.com/feed/", bucket: "used" },
  { name: "Cox Automotive", url: "https://www.coxautoinc.com/feed/", bucket: "used" },
  { name: "CBT News", url: "https://www.cbtnews.com/feed/", bucket: "used" },
];

const LUX = /bentley|rolls[- ]?royce|lamborghini|ferrari|mclaren|aston martin|porsche|maserati|bugatti|koenigsegg|exotic|supercar|hypercar|luxury/i;
const AI_AUTO = /\b(ai|artificial intelligence|machine learning|chatgpt|autonomous|self[- ]driving|robotaxi)\b/i;
const USED_MKT = /used[- ]car|wholesale|auction|residual|trade[- ]in|depreciation|inventory|manheim|price index|affordability|lease returns/i;

const strip = (s) => (s || "")
  .replace(/<!\[CDATA\[|\]\]>/g, "")
  .replace(/<[^>]+>/g, "")
  .replace(/&#8217;|&rsquo;/g, "'").replace(/&#8216;|&lsquo;/g, "'")
  .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
  .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "")
  .trim();

async function fetchFeed(feed) {
  try {
    const res = await fetch(feed.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PinnacleCRM/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items = [...xml.matchAll(/<item[\s\S]*?<\/item>/gi)].slice(0, 15);
    const cutoff = Date.now() - 3 * 86400000; // last 3 days
    return items.map(m => {
      const block = m[0];
      const title = strip((block.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
      const link = strip((block.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]);
      const date = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1];
      const desc = strip((block.match(/<description>([\s\S]*?)<\/description>/i) || [])[1]).slice(0, 180);
      const ts = date ? Date.parse(date) : Date.now();
      return { title, link, desc, ts, source: feed.name, bucket: feed.bucket };
    }).filter(a => a.title && a.link && (!a.ts || a.ts > cutoff));
  } catch (e) { return []; }
}

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
const esc = (s) => String(s || "").replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));

// Same 90% scoring the Hunter uses in the app
const STOP = new Set(["new","used","certified","cpo","awd","rwd","4dr","2dr","all-wheel","wheel","drive","coupe","sedan","suv","convertible","the"]);
function scoreMatch(want, v) {
  want = (want || "").toLowerCase();
  if (!want) return 0;
  const vText = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ").toLowerCase();
  if (!vText.trim()) return 0;
  const wantYear = (want.match(/\b(19|20)\d{2}\b/) || [])[0];
  const tokens = [...new Set(want.replace(/\b(19|20)\d{2}\b/g, " ").split(/[^a-z0-9\-]+/).filter(t => t.length > 1 && !STOP.has(t)))];
  if (!tokens.length) return 0;
  let score = Math.round((tokens.filter(t => vText.includes(t)).length / tokens.length) * 70);
  if (wantYear && v.year) {
    const dy = Math.abs(Number(v.year) - Number(wantYear));
    score += dy === 0 ? 30 : dy === 1 ? 20 : dy === 2 ? 10 : 0;
  } else score += 30;
  return Math.min(score, 100);
}

const sb = async (path) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return r.ok ? r.json() : [];
};

function vehicleCard(v, extra) {
  const name = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  const img = v.photo_url
    ? `<td width="96" style="padding:0 12px 0 0"><img src="${v.photo_url}" width="88" height="62" style="border-radius:4px;object-fit:cover;display:block" alt=""></td>`
    : "";
  return `<tr><td style="padding:9px 0;border-bottom:1px solid #eee"><table width="100%" cellpadding="0" cellspacing="0"><tr>${img}
    <td style="vertical-align:middle">
      <div style="font-size:14px;color:#1a1208;font-weight:600">${esc(name)}</div>
      <div style="font-size:12px;color:#777;margin-top:2px">${esc([v.store, v.mileage ? Number(v.mileage).toLocaleString() + " mi" : null, v.stock_number ? "Stock " + v.stock_number : null].filter(Boolean).join(" · "))}</div>
      ${extra ? `<div style="font-size:12px;color:#8f6b10;margin-top:3px">${extra}</div>` : ""}
      ${v.detail_url ? `<a href="${v.detail_url}" style="font-size:11px;color:#8f6b10">View listing →</a>` : ""}
    </td>
    <td align="right" style="vertical-align:middle;white-space:nowrap">
      ${v.price ? `<div style="font-size:16px;color:#8f6b10;font-weight:600">${money(v.price)}</div>` : ""}
      ${v.prev_price && v.price ? `<div style="font-size:11px;color:#999;text-decoration:line-through">${money(v.prev_price)}</div>` : ""}
    </td></tr></table></td></tr>`;
}

exports.handler = async () => {
  const now = Date.now();
  const [inv, clients] = await Promise.all([
    sb("store_inventory?select=*"),
    sb("clients?select=id,first_name,last_name,vehicle_of_interest,stage,cell,updated_at,created_at"),
  ]);

  const arrivals = inv.filter(v => v.first_seen && Date.parse(v.first_seen) > now - 36 * 3600000);
  const drops = inv.filter(v => v.price_dropped_at && Date.parse(v.price_dropped_at) > now - 7 * 86400000)
    .sort((a, b) => (b.prev_price - b.price) - (a.prev_price - a.price));
  const homeDrops = drops.filter(v => v.store === HOME_STORE);
  const active = clients.filter(c => c.stage !== "Closed" && c.stage !== "Lost");

  const matches = [];
  active.forEach(c => inv.forEach(v => {
    const s = scoreMatch(c.vehicle_of_interest, v);
    if (s >= 90) matches.push({ c, v, s });
  }));
  matches.sort((a, b) => b.s - a.s);

  const cold = active.filter(c => Math.floor((now - Date.parse(c.updated_at || c.created_at)) / 86400000) >= 5);

  // News
  const all = (await Promise.all(FEEDS.map(fetchFeed))).flat();
  const seen = new Set();
  const uniq = all.filter(a => { const k = a.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.ts - a.ts);
  const pick = (test, n, exclude) => uniq.filter(a => test.test(a.title + " " + a.desc) && !exclude.has(a.title)).slice(0, n);
  const used = new Set();
  const luxNews = pick(LUX, 4, used); luxNews.forEach(a => used.add(a.title));
  const aiNews = pick(AI_AUTO, 3, used); aiNews.forEach(a => used.add(a.title));
  const mktNews = pick(USED_MKT, 4, used); mktNews.forEach(a => used.add(a.title));

  const newsList = (items) => items.length === 0
    ? `<div style="font-size:12px;color:#999;padding:6px 0">Nothing new in the last few days.</div>`
    : items.map(a => `<div style="padding:7px 0;border-bottom:1px solid #f0f0f0">
        <a href="${a.link}" style="font-size:13px;color:#1a1208;text-decoration:none;font-weight:600">${esc(a.title)}</a>
        <div style="font-size:11px;color:#999;margin-top:2px">${esc(a.source)}${a.ts ? " · " + new Date(a.ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}</div>
      </div>`).join("");

  const section = (title, color, inner) => `
    <tr><td style="padding:22px 0 8px">
      <div style="font-size:11px;letter-spacing:2.5px;text-transform:uppercase;color:${color};border-bottom:2px solid ${color};padding-bottom:5px">${title}</div>
    </td></tr><tr><td>${inner}</td></tr>`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f7f5f0;font-family:-apple-system,Segoe UI,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f5f0;padding:20px 0"><tr><td align="center">
  <table width="620" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:8px;padding:26px 30px;max-width:620px">
    <tr><td style="border-bottom:3px double #8f6b10;padding-bottom:12px">
      <div style="font-size:20px;letter-spacing:3px;color:#1a1208;font-weight:300">PINNACLE</div>
      <div style="font-size:11px;color:#8f6b10;letter-spacing:2px">JESSICA'S MORNING REPORT</div>
      <div style="font-size:12px;color:#888;margin-top:6px">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
    </td></tr>

    <tr><td style="padding:18px 0 0">
      <table width="100%"><tr>
        ${[["New Arrivals", arrivals.length, "#1f8a52"], ["Price Drops (7d)", drops.length, "#a16207"], ["Client Matches", matches.length, "#8f6b10"], ["Going Cold", cold.length, "#b91c1c"]]
          .map(([l, v, c]) => `<td align="center" style="padding:10px;background:#faf8f4;border-radius:5px">
            <div style="font-size:26px;color:${c};font-weight:600">${v}</div>
            <div style="font-size:10px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-top:2px">${l}</div></td>`).join('<td width="8"></td>')}
      </tr></table>
    </td></tr>

    ${matches.length ? section("★ Client Matches — act on these first", "#1f8a52",
      `<table width="100%">${matches.slice(0, 6).map(({ c, v, s }) =>
        vehicleCard(v, `<b>${s}% match for ${esc(c.first_name || "")} ${esc(c.last_name || "")}</b>${c.cell ? ` · ${esc(c.cell)}` : ""}`)).join("")}</table>`) : ""}

    ${homeDrops.length ? section(`Price Drops at ${HOME_STORE}`, "#a16207",
      `<table width="100%">${homeDrops.slice(0, 6).map(v => vehicleCard(v, `Dropped ${money(v.prev_price - v.price)} on ${new Date(v.price_dropped_at).toLocaleDateString()}`)).join("")}</table>`) : ""}

    ${drops.filter(v => v.store !== HOME_STORE).length ? section("Price Drops — Group Stores", "#a16207",
      `<table width="100%">${drops.filter(v => v.store !== HOME_STORE).slice(0, 8).map(v => vehicleCard(v, `Dropped ${money(v.prev_price - v.price)}`)).join("")}</table>`) : ""}

    ${arrivals.length ? section("New Arrivals — Last 36 Hours", "#1f8a52",
      `<table width="100%">${arrivals.slice(0, 10).map(v => vehicleCard(v)).join("")}</table>`) : ""}

    ${cold.length ? section("Going Cold — no contact in 5+ days", "#b91c1c",
      `<table width="100%">${cold.slice(0, 8).map(c => `<tr><td style="padding:7px 0;border-bottom:1px solid #eee;font-size:13px;color:#333">
        <b>${esc(c.first_name || "")} ${esc(c.last_name || "")}</b> — ${esc(c.vehicle_of_interest || c.stage)}
        <span style="color:#b91c1c;font-size:11px"> · ${Math.floor((now - Date.parse(c.updated_at || c.created_at)) / 86400000)} days quiet</span></td></tr>`).join("")}</table>`) : ""}

    ${section("Luxury &amp; Exotic Market", "#8f6b10", newsList(luxNews))}
    ${section("Used Car Market", "#8f6b10", newsList(mktNews))}
    ${section("AI &amp; the Auto Industry", "#8f6b10", newsList(aiNews))}

    <tr><td style="padding:24px 0 0;border-top:1px solid #eee;font-size:11px;color:#aaa;line-height:1.6">
      Inventory figures come from your Pinnacle database, refreshed by Jessica's overnight scan of all six store websites.
      Headlines are pulled live from automotive industry feeds — Jessica reports them, she doesn't write them.
      <br><a href="https://pinnaclecrm.ai" style="color:#8f6b10">Open Pinnacle CRM →</a>
    </td></tr>
  </table></td></tr></table></body></html>`;

  const subject = `Morning Report — ${matches.length} match${matches.length !== 1 ? "es" : ""}, ${arrivals.length} new, ${drops.length} price drop${drops.length !== 1 ? "s" : ""}`;

  const send = await fetch(`${process.env.URL || "https://pinnaclecrm.ai"}/.netlify/functions/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: REPORT_TO, subject, html }),
  });
  const sendResult = await send.text();

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sentTo: REPORT_TO, subject,
      counts: { arrivals: arrivals.length, drops: drops.length, homeDrops: homeDrops.length, matches: matches.length, cold: cold.length },
      news: { luxury: luxNews.length, used: mktNews.length, ai: aiNews.length, feedsReturned: uniq.length },
      sendResult: sendResult.slice(0, 200),
    }),
  };
};
