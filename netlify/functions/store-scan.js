// Jessica's cross-store inventory scan
// Fetches public inventory pages from the Fields group's Dealer.com sites,
// extracts the embedded vehicle data, and saves it to the store_inventory table
// with new-arrival and price-drop detection.
const SUPABASE_URL = "https://ozrybagfwnsaakjamztl.supabase.co";
const SUPABASE_KEY = "sb_publishable_hkoTQVteawqO4YAbj17F6Q_PmshLH50";

const STORES = [
  { name: "Rolls-Royce Motor Cars Seattle", base: "https://www.rolls-roycemotorcarsseattle.com" },
  { name: "Rolls-Royce Motor Cars Chicago", base: "https://www.rrmc-chicago.com" },
  { name: "Bentley Downers Grove", base: "https://www.bentleydownersgrove.com" },
  { name: "Bentley Gold Coast", base: "https://www.bentleygoldcoast.com" },
  { name: "Bentley Seattle", base: "https://www.bentleyseattle.com" },
];
const PAGES = ["/used-inventory/index.htm", "/new-inventory/index.htm"];
const PAGE_SIZE = 24;
const MAX_PAGES = 4; // up to 96 vehicles per list — plenty for these stores

// Pull every JSON object containing a "vin" out of the raw HTML by brace-matching
function extractVehicles(html) {
  const out = {};
  const re = /"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    // walk back to the opening brace of the enclosing object
    let start = m.index;
    let depth = 0;
    while (start > 0) {
      const ch = html[start];
      if (ch === "}") depth++;
      if (ch === "{") { if (depth === 0) break; depth--; }
      start--;
    }
    // walk forward to the matching closing brace
    let end = start, d = 0;
    for (; end < html.length; end++) {
      if (html[end] === "{") d++;
      if (html[end] === "}") { d--; if (d === 0) break; }
    }
    try {
      const v = JSON.parse(html.slice(start, end + 1));
      if (!v.vin || out[v.vin]) continue;
      const price = parsePrice(v.internetPrice ?? v.askingPrice ?? v.salePrice ?? v.msrp ?? (v.pricing && (v.pricing.internetPrice ?? v.pricing.retailPrice)));
      out[v.vin] = {
        vin: v.vin,
        year: Number(v.modelYear || v.year) || null,
        make: v.make || null,
        model: v.model || null,
        trim: v.trim || null,
        price: price,
        mileage: Number(v.odometer) || null,
        condition: (v.type || v.inventoryType || "").toLowerCase() || null,
        stock_number: v.stockNumber || null,
      };
    } catch (e) { /* not a clean object — skip */ }
  }
  return Object.values(out);
}

function parsePrice(p) {
  if (p == null) return null;
  const n = parseFloat(String(p).replace(/[^0-9.]/g, ""));
  return isNaN(n) || n <= 0 ? null : n;
}

async function fetchStore(store) {
  const vehicles = {};
  for (const page of PAGES) {
    for (let i = 0; i < MAX_PAGES; i++) {
      const url = `${store.base}${page}?start=${i * PAGE_SIZE}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (PinnacleCRM group inventory sync)" } });
        if (!res.ok) break;
        const found = extractVehicles(await res.text());
        if (found.length === 0) break;
        let anyNew = false;
        found.forEach(v => { if (!vehicles[v.vin]) { vehicles[v.vin] = v; anyNew = true; } });
        if (!anyNew || found.length < PAGE_SIZE) break; // last page reached
      } catch (e) { break; }
    }
  }
  return Object.values(vehicles).map(v => ({ ...v, store: store.name }));
}

exports.handler = async () => {
  const now = new Date().toISOString();
  const perStore = {};
  let all = [];
  for (const store of STORES) {
    const vs = await fetchStore(store);
    perStore[store.name] = vs.length;
    all = all.concat(vs);
  }
  // Some group cars are cross-listed on two sister sites — keep one row per VIN
  const seenVins = new Set();
  all = all.filter(v => { if (seenVins.has(v.vin)) return false; seenVins.add(v.vin); return true; });

  // Existing rows → detect new arrivals and price drops
  const existingRes = await fetch(SUPABASE_URL + "/rest/v1/store_inventory?select=vin,price,prev_price,price_dropped_at,first_seen", {
    headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
  });
  const existing = existingRes.ok ? await existingRes.json() : [];
  const priorByVin = Object.fromEntries(existing.map(r => [r.vin, r]));

  const newArrivals = [];
  const priceDrops = [];
  // Every row must carry an identical set of keys. PostgREST rejects a bulk
  // insert where objects differ (PGRST102: "All object keys must match"),
  // which previously caused the whole scan to save nothing.
  const rows = all.map(v => {
    const prior = priorByVin[v.vin];
    const row = {
      vin: v.vin, store: v.store, year: v.year, make: v.make, model: v.model,
      trim: v.trim, price: v.price, mileage: v.mileage, condition: v.condition,
      stock_number: v.stock_number,
      prev_price: prior ? (prior.prev_price ?? null) : null,
      price_dropped_at: prior ? (prior.price_dropped_at ?? null) : null,
      first_seen: prior ? (prior.first_seen ?? now) : now,
      last_seen: now,
    };
    if (!prior) {
      newArrivals.push(v);
    } else {
      const oldP = Number(prior.price);
      if (oldP && v.price && v.price < oldP) {
        row.prev_price = oldP;
        row.price_dropped_at = now;
        priceDrops.push({ ...v, oldPrice: oldP, newPrice: v.price });
      }
    }
    return row;
  });

  let saved = 0, saveError = null;
  if (rows.length > 0) {
    const up = await fetch(`${SUPABASE_URL}/rest/v1/store_inventory?on_conflict=vin`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(rows),
    });
    if (up.ok) saved = rows.length; else saveError = await up.text();
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scannedAt: now, perStore, total: all.length, saved, saveError, newArrivals: newArrivals.length, priceDrops }),
  };
};
