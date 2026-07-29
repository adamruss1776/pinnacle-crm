// Public, read-only inventory feed.
// Lets luxeamexotics.com (or any marketing page) display Fields Motorcars Orlando
// inventory without carrying a database key. Only non-sensitive listing fields are
// returned, and only for the home store — nothing about clients ever passes through here.
const SUPABASE_URL = "https://ozrybagfwnsaakjamztl.supabase.co";
const SUPABASE_KEY = "sb_publishable_hkoTQVteawqO4YAbj17F6Q_PmshLH50";
const HOME_STORE = "Fields Motorcars Orlando";
const DEALER_URL = "https://www.fieldsmotorcarsorlando.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=900", // 15 min — scan only runs daily
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };

  const qs = (event && event.queryStringParameters) || {};
  const limit = Math.min(Number(qs.limit) || 60, 120);

  try {
    const url = `${SUPABASE_URL}/rest/v1/store_inventory`
      + `?store=eq.${encodeURIComponent(HOME_STORE)}`
      + `&select=vin,year,make,model,trim,price,mileage,condition,stock_number,photo_url,detail_url,first_seen`
      + `&order=price.desc&limit=${limit}`;
    const res = await fetch(url, { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } });
    if (!res.ok) throw new Error("inventory unavailable");
    const rows = await res.json();

    const vehicles = rows
      .filter(v => v.year && v.make && v.model)
      .map(v => ({
        vin: v.vin,
        year: v.year, make: v.make, model: v.model, trim: v.trim || "",
        price: v.price ? Number(v.price) : null,
        mileage: v.mileage ? Number(v.mileage) : null,
        condition: v.condition || "",
        stock: v.stock_number || "",
        photo: v.photo_url || null,
        // Every car links back to the dealership's own listing
        dealerUrl: v.detail_url || DEALER_URL,
        isNew: v.first_seen ? (Date.now() - Date.parse(v.first_seen)) < 14 * 86400000 : false,
      }));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        // Disclosure travels with the data so any page showing it states the facts
        seller: HOME_STORE,
        sellerUrl: DEALER_URL,
        disclosure: `All vehicles are offered for sale by ${HOME_STORE}, a licensed Florida dealer, and are located at the dealership. Adam Russell is a sales representative of ${HOME_STORE}. All transactions are conducted through the dealership. Pricing and availability are subject to change; verify current details on the dealership's website.`,
        updatedAt: new Date().toISOString(),
        count: vehicles.length,
        vehicles,
      }),
    };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ vehicles: [], count: 0, error: "Inventory temporarily unavailable" }) };
  }
};
