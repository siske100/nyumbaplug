import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

export async function freshDb() {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, "stub.sql"), "utf8"));
  for (const f of readdirSync(join(root, "migrations")).filter((n) => n.endsWith(".sql")).sort()) {
    try { await db.exec(readFileSync(join(root, "migrations", f), "utf8")); }
    catch (e) { throw new Error(`Migration ${f} failed: ${e.message}`); }
  }
  await db.exec(readFileSync(join(root, "seed", "seed.sql"), "utf8"));
  return db;
}

/** Run SQL as a given caller: { uid, role } where role is authenticated, anon or service_role. */
export async function as(db, who, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who.uid ?? ""]);
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: who.uid || undefined, aal: who.aal ?? "aal2", role: who.role ?? "authenticated" })]);
  await db.exec(`set role ${who.role ?? "authenticated"}`);
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("reset role"); }
}
/** aal2 means the person passed their authenticator code. Pass "aal1" to simulate a password-only session. */
export const user = (uid, aal = "aal2") => ({ uid, role: "authenticated", aal });
export const anon = { uid: "", role: "anon" };
export const server = { uid: "", role: "service_role" };

/** Create a login the way Supabase would. The signup trigger builds the profile. */
export async function mkUser(db, email, { app = {}, meta = {} } = {}) {
  const r = await db.query(
    "insert into auth.users(email, raw_app_meta_data, raw_user_meta_data) values ($1, $2::jsonb, $3::jsonb) returning id",
    [email, JSON.stringify(app), JSON.stringify(meta)],
  );
  return r.rows[0].id;
}
export async function sql(db, text, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)");
  return (await db.query(text, params)).rows;
}

import assert from "node:assert/strict";
export async function rejects(promise, pattern) {
  try { await promise; } catch (e) { assert.match(e.message, pattern); return; }
  assert.fail(`expected an error matching ${pattern}`);
}

/** Two landlords, a tenant for each and an admin, with houses, photos, tenancies and charges. */
export async function buildWorld(db) {
  const w = {};
  w.admin = await mkUser(db, "admin@x.ke", { app: { invited_role: "admin" } });
  w.la = await mkUser(db, "la@x.ke");
  w.lb = await mkUser(db, "lb@x.ke");
  w.ta = await mkUser(db, "ta@x.ke", { app: { invited_role: "tenant" } });
  w.tb = await mkUser(db, "tb@x.ke", { app: { invited_role: "tenant" } });
  for (const id of [w.la, w.lb]) await sql(db, "update profiles set landlord_state='active', phone_verified=true where id=$1", [id]);

  const town = (await sql(db, "select id from towns where name='Bungoma Town'"))[0].id;
  const mkHouse = async (landlord, title, total, vacant) => {
    const h = (await sql(db,
      `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
       values ($1,$2,39,$3,'Bedsitter',6500,6500,$4,$5) returning id`, [landlord, title, town, total, vacant]))[0].id;
    for (let p = 0; p < 3; p++) await sql(db, "insert into house_photos(house_id,position,storage_path) values ($1,$2,$3)", [h, p, `${landlord}/${h}/${p}.jpg`]);
    return h;
  };
  w.hA = await mkHouse(w.la, "Block A", 4, 3);
  w.hA2 = await mkHouse(w.la, "Block A2", 2, 0);
  w.hB = await mkHouse(w.lb, "Block B", 3, 3);

  const mkTenancy = async (landlord, house, unit, tphone, ephone, tenantUser) => {
    const t = (await as(db, user(landlord),
      `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
       values ($1,$2,$3,'Tenant','${tphone}','Emergency','${ephone}','mother',6500,6500,5) returning id`, [landlord, house, unit]))[0].id;
    await sql(db, "update tenancies set tenant_user_id=$1 where id=$2", [tenantUser, t]);
    await sql(db, "insert into charges(tenancy_id,landlord_id,period_year,period_month,amount) values ($1,$2,2026,10,6500)", [t, landlord]);
    return t;
  };
  w.tA = await mkTenancy(w.la, w.hA, "A1", "0711000001", "0722000001", w.ta);
  w.tB = await mkTenancy(w.lb, w.hB, "B1", "0711000002", "0722000002", w.tb);
  return w;
}
