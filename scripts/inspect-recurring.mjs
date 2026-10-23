import { createClient } from "@supabase/supabase-js";
process.loadEnvFile("/Users/upashanak/sam-ai-main/.env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
for (const t of ["recurring_templates", "recurring_instances", "results", "initiatives"]) {
  const { data, error, count } = await db.from(t).select("*", { count: "exact" }).limit(1);
  console.log(t, error ? `ERR ${error.code} ${error.message}` : `rows=${count} cols=${data[0] ? Object.keys(data[0]).join(",") : "(empty)"}`);
}
const { data: rec, error } = await db
  .from("initiatives")
  .select("id,name,kind,repeat_frequency,attrs,category_id,activation_date,event_date,revenue_good,revenue_close_date,status")
  .in("kind", ["recurring", "ongoing", "evergreen"])
  .limit(20);
console.log(error ?? rec.map((r) => ({ ...r, attrs: Object.keys(r.attrs || {}).join("|"), rf: r.attrs?.repeat_frequency })));
const { data: rs } = await db.from("results").select("initiative_id,week_start_date,week_end_date,actual_revenue,metrics").limit(3);
console.log(rs);
