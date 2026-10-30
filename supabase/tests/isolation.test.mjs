import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, mkUser, sql, rejects, buildWorld } from "./helpers.mjs";

describe("sign-up and roles", () => {
  let db;
  before(async () => { db = await freshDb(); });

  it("a plain sign-up becomes a landlord waiting for email verification, with a wallet and payment account", async () => {
    const id = await mkUser(db, "new@x.ke");
    const [p] = await sql(db, "select role, landlord_state from profiles where id=$1", [id]);
    assert.deepEqual(p, { role: "landlord", landlord_state: "pending_email" });
    assert.equal((await sql(db, "select 1 from sms_wallets where landlord_id=$1", [id])).length, 1);
    assert.equal((await sql(db, "select mode from payment_accounts where landlord_id=$1", [id]))[0].mode, "platform");
  });
  it("Google sign-up skips email verification", async () => {
    const id = await mkUser(db, "g@x.ke", { app: { provider: "google" } });
    const [p] = await sql(db, "select landlord_state, email_verified from profiles where id=$1", [id]);
    assert.deepEqual(p, { landlord_state: "pending_phone", email_verified: true });
  });
  it("a user cannot choose a role through their own sign-up details", async () => {
    const id = await mkUser(db, "sneaky@x.ke", { meta: { role: "admin", invited_role: "admin" } });
    assert.equal((await sql(db, "select role from profiles where id=$1", [id]))[0].role, "landlord");
  });
  it("only the server can invite an admin or tenant", async () => {
    const id = await mkUser(db, "adm@x.ke", { app: { invited_role: "admin" } });
    assert.equal((await sql(db, "select role from profiles where id=$1", [id]))[0].role, "admin");
    await rejects(mkUser(db, "oldcare@x.ke", { app: { invited_role: "caretaker" } }), /Caretaker accounts are no longer supported/);
  });
  it("a user can rename themselves but never change their role or state", async () => {
    const id = await mkUser(db, "esc@x.ke");
    await as(db, user(id), "update profiles set full_name='Esc' where id=$1", [id]);
    await rejects(as(db, user(id), "update profiles set role='admin' where id=$1", [id]), /permission denied/);
    await rejects(as(db, user(id), "update profiles set landlord_state='active' where id=$1", [id]), /permission denied/);
    await rejects(as(db, user(id), "update profiles set phone_verified=true where id=$1", [id]), /permission denied/);
  });
});

describe("who can read what", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("strangers can read nothing except public listings", async () => {
    for (const t of ["houses", "tenancies", "profiles", "ledger_entries", "visit_requests", "payment_accounts", "kyc_submissions"])
      await rejects(as(db, anon, `select * from ${t}`), /permission denied/);
    const rows = await as(db, anon, "select * from public_listings");
    assert.equal(rows.length, 2);                        // Block A (3 vacant) and Block B (3 vacant). Block A2 is full.
    assert.ok(!Object.keys(rows[0]).some((k) => /^(landlord_id|phone|email|full_name)$/i.test(k)), "public listing must not expose landlord details");
  });
  it("full houses, suspended landlords and houses with fewer than 3 photos are hidden from search", async () => {
    assert.ok(!(await as(db, anon, "select id from public_listings")).some((r) => r.id === w.hA2));
    await sql(db, "delete from house_photos where house_id=$1 and position=2", [w.hB]);
    assert.ok(!(await as(db, anon, "select id from public_listings")).some((r) => r.id === w.hB));
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.la]);
    assert.equal((await as(db, anon, "select id from public_listings")).length, 0);
    await sql(db, "update profiles set landlord_state='active' where id=$1", [w.la]);
    await sql(db, "insert into house_photos(house_id,position,storage_path) values ($1,2,'x')", [w.hB]);
  });
  it("landlord B cannot see or change landlord A's data", async () => {
    for (const t of ["houses", "tenancies", "charges", "ledger_entries", "payment_attempts", "complaints", "notices", "payment_accounts", "sms_wallets"]) {
      const rows = await as(db, user(w.lb), `select count(*)::int n from ${t} where ${t === "payment_accounts" || t === "sms_wallets" ? "landlord_id" : t === "houses" ? "landlord_id" : "landlord_id"} = $1`, [w.la]).catch(() => [{ n: 0 }]);
      assert.equal(rows[0].n, 0, t);
    }
    assert.equal((await as(db, user(w.lb), "update houses set title='hacked' where id=$1 returning id", [w.hA])).length, 0);
    await rejects(as(db, user(w.lb), `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
       values ($1,'Fake',39,(select id from towns limit 1),'Bedsitter',1000,0,1,1)`, [w.la]), /row-level security/);
    await rejects(as(db, user(w.lb), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
       values ($1,$2,'X','Tom','0711999999','Emma','0722999999','mum',1000,0,5)`, [w.lb, w.hA]), /foreign key|row-level security/);
  });
  it("a landlord can edit their own house listing but cannot change its ownership", async () => {
    const updated = await as(db, user(w.la), "update houses set title='Updated Block A', rent_amount=7200, rules='No smoking' where id=$1 returning id", [w.hA]);
    assert.deepEqual(updated, [{ id: w.hA }]);
    assert.deepEqual((await sql(db, "select title, rent_amount, rules from houses where id=$1", [w.hA]))[0], {
      title: "Updated Block A", rent_amount: 7200, rules: "No smoking",
    });
    assert.equal((await as(db, user(w.lb), "update houses set title='Other landlord edit' where id=$1 returning id", [w.hA])).length, 0);
    await rejects(as(db, user(w.la), "update houses set landlord_id=$1 where id=$2", [w.lb, w.hA]), /permission denied/);
  });
  it("payment credentials and callback secrets can never be read from a browser", async () => {
    await rejects(as(db, user(w.la), "select credentials_ciphertext from payment_accounts"), /permission denied/);
    await rejects(as(db, user(w.la), "select callback_token from payment_accounts"), /permission denied/);
    await rejects(as(db, user(w.la), "select * from payment_accounts"), /permission denied/);
    await rejects(as(db, user(w.la), "update payment_accounts set mode='own'"), /permission denied/);
    const ok = await as(db, user(w.la), "select mode, status from payment_accounts");
    assert.deepEqual(ok, [{ mode: "platform", status: "not_connected" }]);
  });
  it("the admin sees landlords and billing but never tenants, rent, complaints or SMS recipients", async () => {
    await sql(db, "insert into sms_messages(landlord_id,template,recipient,body,segments,cost_kes,status) values ($1,'broadcast','0711000001','hi',1,0.8,'sent')", [w.la]);
    for (const t of ["tenancies", "ledger_entries", "charges", "complaints", "sms_messages", "payment_attempts", "houses"])
      assert.equal((await as(db, user(w.admin), `select 1 from ${t}`)).length, 0, `admin must not see ${t}`);
    assert.equal((await as(db, user(w.admin), "select 1 from profiles where role='landlord'")).length, 2);
    assert.equal((await as(db, user(w.admin), "select 1 from admin_landlord_overview")).length, 2);
    assert.equal((await as(db, user(w.la), "select 1 from admin_landlord_overview")).length, 0);
  });
  it("a tenant sees only their own tenancy, balance and payments", async () => {
    assert.deepEqual((await as(db, user(w.ta), "select id from tenancies")).map((r) => r.id), [w.tA]);
    assert.deepEqual((await as(db, user(w.ta), "select balance from tenancy_balances")).map((r) => r.balance), [6500]);
    // no update policy exists for tenants, so a write changes zero rows
    assert.equal((await as(db, user(w.ta), "update tenancies set rent_amount=1 where id=$1 returning id", [w.tA])).length, 0);
    assert.equal((await sql(db, "select rent_amount from tenancies where id=$1", [w.tA]))[0].rent_amount, 6500);
  });
  it("when a landlord is suspended, their dashboard data and their tenants' access lock", async () => {
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.la]);
    assert.equal((await as(db, user(w.la), "select 1 from houses")).length, 0);
    assert.equal((await as(db, user(w.ta), "select 1 from tenancies")).length, 0);
    assert.equal((await as(db, user(w.ta), "select 1 from ledger_entries")).length, 0);
    await rejects(as(db, user(w.la), `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
       values ($1,'New',39,(select id from towns limit 1),'Bedsitter',1000,0,1,1)`, [w.la]), /row-level security/);
    assert.equal((await as(db, user(w.lb), "select 1 from houses")).length, 1);   // other landlords unaffected
    await sql(db, "update profiles set landlord_state='active' where id=$1", [w.la]);
  });
  it("browsers cannot call server-only functions", async () => {
    for (const fn of ["confirm_payment('x','y',1,'0711000001')", "record_c2b_payment('a',1,'b','0711000001')", "create_payout('" + w.la + "')",
                      "sms_charge('" + w.la + "','broadcast','0711000001','hi',1)", "expire_subscriptions()", "activate_subscription('" + w.la + "','REF12345',1000)",
                      "mark_contact_verified('" + w.la + "','email')", "create_visit_request('" + w.hA + "','A B','0711000009',current_date,'Morning')"]) {
      await rejects(as(db, user(w.la), `select ${fn}`), /permission denied/);
      await rejects(as(db, anon, `select ${fn}`), /permission denied/);
    }
  });
});

describe("function privileges (a guard for every future migration)", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });
  const callable = async (role) => (await sql(db, `select p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.prokind = 'f' and has_function_privilege('${role}', p.oid, 'execute') order by 1`)).map((r) => r.n);

  it("a stranger can run exactly one function: the public price calculator", async () => {
    assert.deepEqual(await callable("anon"), ["price_for_units"]);
  });
  it("a signed-in user can run only the reviewed list. Any new function must be added here on purpose", async () => {
    assert.deepEqual(await callable("authenticated"), [
      "admin_celcom_topup", "admin_mark_payout_paid", "admin_resume_landlord", "admin_suspend_landlord", "agreement_visible_to_me", "is_admin", "landlord_active", "price_for_units",
      "resolve_held_payment", "reschedule_visit", "reverse_payment", "review_kyc", "set_my_phone", "set_payment_mode", "submit_kyc", "update_my_emergency_contact",
    ].sort());
  });
  it("functions that bypass row-level security cannot be used to peek at other people's data", async () => {
    await rejects(as(db, user(w.lb), "select current_balance($1)", [w.tA]), /permission denied/);
    await rejects(as(db, user(w.lb), "select landlord_units($1)", [w.la]), /permission denied/);
  });
});
