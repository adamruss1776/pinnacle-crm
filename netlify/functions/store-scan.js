// Jessica's cross-store inventory scan
// Fetches public inventory pages from the Fields group's Dealer.com sites,
// extracts the embedded vehicle data, and saves it to the store_inventory table
// with new-arrival and price-drop detection.
const SUPABASE_URL = "https://ozrybagfwnsaakjamztl.supabase.co";
const SUPABASE_KEY = "sb_publishable_hkoTQVteawqO4YAbj17F6Q_PmshLH50";

const STORES = [
  { name: "Fields Motorcars Orlando", base: "https://www.fieldsmotorcarsorlando.com", home: true },
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
        photo_url: (v.images && v.images[0] && v.images[0].uri) || null,
        detail_url: v.link || null,
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
  return Object.values(vehicles).map(v => ({
    ...v,
    store: store.name,
    detail_url: v.detail_url ? (v.detail_url.startsWith("http") ? v.detail_url : store.base + v.detail_url) : null,
  }));
}

function __slug(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
async function __syncToInventory(store, vs){
  try{
    const src=__slug(store.name);
    const now=new Date().toISOString();
    const rows=(vs||[]).filter(function(v){return v.vin;}).map(function(v){ return {
      vin:v.vin, year:(v.year!=null)?String(v.year):null, make:v.make||null, model:v.model||null, trim:v.trim||null,
      color:v.color||null, price:(v.price!=null)?v.price:null, mileage:(v.mileage!=null)?String(v.mileage):null,
      store:store.name, status:(String(v.condition||'').toLowerCase().indexOf('new')>-1)?'New':'Used',
      stock_number:v.stock_number||null, source:src, last_seen:now, updated_at:now }; });
    if(!rows.length) return;
    await fetch(`${SUPABASE_URL}/rest/v1/inventory?on_conflict=vin`, { method:'POST', headers:{ apikey:SUPABASE_KEY, Authorization:'Bearer '+SUPABASE_KEY, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' }, body:JSON.stringify(rows) });
    const vinList=rows.map(function(r){return '"'+r.vin+'"';}).join(',');
    if(vinList) await fetch(`${SUPABASE_URL}/rest/v1/inventory?source=eq.${src}&vin=not.in.(${vinList})`, { method:'DELETE', headers:{ apikey:SUPABASE_KEY, Authorization:'Bearer '+SUPABASE_KEY } });
  }catch(e){}
}

// ── GENERIC EXTRACTOR (non-Dealer.com sites, e.g. AutoDriven/Next.js) ──
function __extractGeneric(html){
  const out={};
  const re=/"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/g; let m;
  const pp=function(x){ if(x==null) return null; const n=parseFloat(String(x).replace(/[^0-9.]/g,'')); return (isNaN(n)||n<=0)?null:n; };
  const mi=function(x){ if(x==null) return null; const n=parseInt(String(x).replace(/[^0-9]/g,''),10); return isNaN(n)?null:n; };
  while((m=re.exec(html))!==null){
    let s=m.index,depth=0;
    while(s>0){ const c=html[s]; if(c==='}')depth++; if(c==='{'){ if(depth===0)break; depth--; } s--; }
    let e=s,d=0;
    for(;e<html.length;e++){ if(html[e]==='{')d++; if(html[e]==='}'){ d--; if(d===0)break; } }
    try{
      const v=JSON.parse(html.slice(s,e+1));
      if(!v.vin || out[v.vin]) continue;
      const price=pp(v.internetPrice || v.askingPrice || v.salePrice || v.specialprice || v.price || v.msrp || (v.pricing && (v.pricing.internetPrice || v.pricing.retailPrice)));
      out[v.vin]={
        vin:v.vin,
        year:Number(v.modelYear||v.year)||null,
        make:v.make||null, model:v.model||null, trim:v.trim||null,
        price:price,
        mileage:mi(v.odometer ?? v.mileage ?? v.miles),
        condition:(String(v.condition||v.type||v.inventoryType||'').toLowerCase().indexOf('new')>-1)?'New':'Used',
        stock_number:v.stockNumber||v.stocknumber||v.stock||null,
        photo_url:v.featuredphoto||v.photo||v.image||null,
        detail_url:v.url||v.detail_url||v.vdp||null
      };
    }catch(_){}
  }
  return Object.values(out);
}
function __extractSchema(html){
  var Q=String.fromCharCode(34), BS=String.fromCharCode(92), OB=String.fromCharCode(123), CB=String.fromCharCode(125);
  var un=html.split(BS+Q).join(Q);
  var out={}, re=/"vehicleIdentificationNumber":"([A-HJ-NPR-Z0-9]{17})"/g, m;
  function enc(str,idx){var s=idx,depth=0;while(s>0){var c=str[s];if(c===CB)depth++;if(c===OB){if(depth===0)break;depth--;}s--;}var e=s,d=0;for(;e<str.length;e++){if(str[e]===OB)d++;if(str[e]===CB){d--;if(d===0)break;}}return str.slice(s,e+1);}
  function g(obj,rx){var x=obj.match(rx);return x?x[1]:null;}
  while((m=re.exec(un))!==null){
    var vin=m[1]; if(out[vin])continue;
    var obj=enc(un,m.index);
    var pr=g(obj,/"price":(\d+)/);
    out[vin]={
      vin:vin,
      year:g(obj,/"vehicleModelDate":"?(\d{4})/)||g(obj,/"modelDate":"?(\d{4})/)||null,
      make:g(obj,/"brand":\{[^{}]*"name":"([^"]+)"/)||null,
      model:g(obj,/"model":"([^"]+)"/)||null,
      trim:null,
      price:pr?Number(pr):null,
      mileage:g(obj,/"mileageFromOdometer":\{[^{}]*"value":(\d+)/)||null,
      condition:obj.indexOf("UsedCondition")>-1?"Used":(obj.indexOf("NewCondition")>-1?"New":"Used"),
      stock_number:g(obj,/"sku":"([^"]+)"/)||null,
      photo_url:g(obj,/"image":"([^"]+)"/)||null,
      detail_url:g(obj,/"url":"([^"]+)"/)||null
    };
  }
  return Object.values(out);
}
async function __fetchGeneric(store){
  const out={};
  for(let pg=1; pg<=12; pg++){
    let found=[];
    try{
      const res=await fetch(store.base+'/inventory?page='+pg, { headers:{ 'User-Agent':'Mozilla/5.0 (PinnacleCRM scan)' } });
      if(!res.ok) break;
      var __txt=await res.text(); found=__extractGeneric(__txt); if(!found.length) found=__extractSchema(__txt);
    }catch(e){ break; }
    if(!found.length) break;
    let anyNew=false;
    found.forEach(function(v){ v.store=store.name; if(!out[v.vin]){ out[v.vin]=v; anyNew=true; } });
    if(!anyNew) break;
  }
  return Object.values(out);
}

exports.handler = async () => {
  const now = new Date().toISOString();
  const perStore = {};
  let all = [];
    try {
    const dq = await fetch(`${SUPABASE_URL}/rest/v1/dealerships?select=name,base_url,feeds&active=eq.true`, { headers:{ apikey:SUPABASE_KEY, Authorization:'Bearer '+SUPABASE_KEY } });
    if (dq.ok) {
      const extra = await dq.json();
      const norm = function(u){ return String(u||'').replace(/\/+$/,'').toLowerCase(); };
      const have = new Set(STORES.map(function(s){return norm(s.base);}));
      for (const d of (extra||[])) {
        const b = String(d.base_url||'').replace(/\/+$/,'');
        if (!b) continue;
        if (have.has(norm(b))) { if (d.feeds==='main'){ const ex=STORES.find(function(s){return norm(s.base)===norm(b);}); if(ex) ex.toInventory=true; } continue; }
        STORES.push({ name:d.name, base:b, toInventory:d.feeds==='main' });
        have.add(norm(b));
      }
    }
  } catch(e) {}
  
  for (const store of STORES) {
    let vs = await fetchStore(store);
    if (!vs || !vs.length) { vs = await __fetchGeneric(store); }
    if (store.home || store.toInventory) { await __syncToInventory(store, vs); }
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
      photo_url: v.photo_url ?? null, detail_url: v.detail_url ?? null,
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
    // Normalize: every row must share the same key set for PostgREST bulk upsert
    const __allKeys = Array.from(new Set(rows.flatMap(function(r){ return Object.keys(r); })));
    for (let __i=0; __i<rows.length; __i++){ const __r=rows[__i]; const __o={}; for (const __k of __allKeys){ __o[__k]=(__r[__k]===undefined)?null:__r[__k]; } rows[__i]=__o; }

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

// scraper: dealership-driven + generic fallback
