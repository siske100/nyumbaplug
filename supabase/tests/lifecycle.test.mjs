import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, mkUser, sql, rejects, buildWorld } from "./helpers.mjs";

const one = async (db, text, params) => (await sql(db, text, params))[0];

describe("landlord journey: verification, subscription, suspension", () => {
  let db, admin, l;
  before(async () => { db = await freshDb(); admin = await mkUser(db, "admin@x.ke", { app: { invited_role: "admin" } }); l = await mkUser(db, "land@x.ke", { meta: { phone: "0712345678" } }); });
  const state = async (id = l) => (await one(db, "select landlord_state s from profiles where id=$1", [id])).s;
  const paths = (id) => [`${id}/id-front.jpg`, `${id}/id-back.jpg`, `${id}/kra.pdf`];
  const submit = (id = l, nid = "29876543", kra = "a009876543k") => as(db, user(id), "select submit_kyc($1,$2,$3,$4,$5) id", [nid, kra, ...paths(id)]);

  it("email confirmation unlocks documents without verifying the landlord phone", async () => {
    assert.equal(await state(), "pending_email");
    await rejects(submit(), /cannot be submitted/);
    await as(db, server, "select mark_contact_verified($1,'email')", [l]);
    assert.equal(await state(), "pending_kyc");
    assert.deepEqual(await one(db, "select phone, phone_verified from profiles where id=$1", [l]), { phone: "0712345678", phone_verified: false });
    const ready = await mkUser(db, "ready@x.ke", { meta: { phone: "0711222333" } });
    await as(db, server, "select mark_contact_verified($1,'email')", [ready]);
    await submit(ready);
    assert.equal(await state(ready), "kyc_submitted");
  });
  it("Google landlords with no phone can add one without an SMS code", async () => {
    const googleLandlord = await mkUser(db, "google-land@x.ke", { app: { provider: "google" } });
    assert.equal(await state(googleLandlord), "pending_phone");
    await as(db, user(googleLandlord), "select set_my_phone('0711222333')");
    assert.equal(await state(googleLandlord), "pending_kyc");
    assert.deepEqual(await one(db, "select email_verified, phone_verified from profiles where id=$1", [googleLandlord]), { email_verified: true, phone_verified: false });
    await rejects(as(db, server, "select issue_phone_code($1,'hash')", [googleLandlord]), /not verified with a code/);
  });
  it("documents must be valid and stored in the landlord's own folder", async () => {
    await rejects(as(db, user(l), "select submit_kyc('12','A009876543K',$1,$2,$3)", paths(l)), /check constraint/);
    await rejects(as(db, user(l), "select submit_kyc('29876543','BAD',$1,$2,$3)", paths(l)), /check constraint/);
    await rejects(as(db, user(l), "select submit_kyc('29876543','A009876543K','someone-else/a.jpg',$1,$2)", paths(l).slice(1)), /check constraint/);
  });
  it("review needs the admin, a written reason to reject, and caps retries at three", async () => {
    await submit(); assert.equal(await state(), "kyc_submitted");
    await rejects(submit(), /cannot be submitted/);
    const sid = async () => (await one(db, "select id from kyc_submissions where landlord_id=$1 and status='pending'", [l])).id;
    await rejects(as(db, user(l), "select review_kyc($1,true)", [await sid()]), /Not allowed/);
    await rejects(as(db, user(admin), "select review_kyc($1,false,'  ')", [await sid()]), /reason is required/);
    await as(db, user(admin), "select review_kyc($1,false,'ID photo is blurry')", [await sid()]);
    assert.equal(await state(), "pending_kyc");
    await submit(); await as(db, user(admin), "select review_kyc($1,false,'KRA name differs')", [await sid()]);
    await submit(); await as(db, user(admin), "select review_kyc($1,false,'Still unclear')", [await sid()]);
    await rejects(submit(), /Maximum attempts/);
  });
  it("approval, then subscription activates the account; the price follows the number of units", async () => {
    const l2 = await mkUser(db, "land2@x.ke", { meta: { phone: "0713000000" } });
    await rejects(as(db, server, "select activate_subscription($1,'MPESA0001',1000)", [l2]), /Complete verification/);
    await as(db, server, "select mark_contact_verified($1,'email')", [l2]);
    await submit(l2, "31122334", "A011223344B");
    const sid = (await one(db, "select id from kyc_submissions where landlord_id=$1", [l2])).id;
    await as(db, user(admin), "select review_kyc($1,true)", [sid]);
    assert.equal(await state(l2), "kyc_approved");
    await sql(db, "select 1");
    const town = (await one(db, "select id from towns limit 1")).id;
    await sql(db, `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
      values ($1,'Big block',(select county_id from towns where id=$2),$2,'Bedsitter',5000,5000,25,25)`, [l2, town]);
    assert.equal((await one(db, "select price_for_units(20) a, price_for_units(21) b, price_for_units(25) c")).c, 1075);
    assert.equal((await as(db, user(l2), "select 1 from admin_landlord_overview")).length, 0);   // landlords cannot use the admin overview
    assert.deepEqual((await as(db, user(admin), "select units, monthly_price from admin_landlord_overview where landlord_id=$1", [l2]))[0], { units: 25, monthly_price: 1075 });
    await rejects(as(db, server, "select activate_subscription($1,'MPESA0002',1000)", [l2]), /below the monthly price of 1075/);
    await as(db, server, "select activate_subscription($1,'MPESA0003',1075)", [l2]);
    assert.equal(await state(l2), "active");
    const sub = await one(db, "select (period_end - period_start) d, period_start = current_date as today from subscriptions where landlord_id=$1", [l2]);
    assert.deepEqual(sub, { d: 30, today: true });
    await as(db, server, "select activate_subscription($1,'MPESA0003',1075)", [l2]);          // the same receipt again
    assert.equal((await one(db, "select count(*)::int n from subscription_payments where landlord_id=$1", [l2])).n, 1);
    await as(db, server, "select activate_subscription($1,'MPESA0004',1075)", [l2]);          // early renewal adds 30 days to the end date
    assert.equal((await one(db, "select (period_end - current_date) d from subscriptions where landlord_id=$1", [l2])).d, 60);
    await rejects(sql(db, "update subscription_payments set amount_kes=1"), /append-only/);
  });
  it("an expired subscription locks the account and hides its houses", async () => {
    const e = await mkUser(db, "exp@x.ke");
    await sql(db, "update profiles set landlord_state='kyc_approved' where id=$1", [e]);
    await as(db, server, "select activate_subscription($1,'MPESAEXP1',1000)", [e]);
    const town = (await one(db, "select id, county_id from towns limit 1"));
    const h = (await one(db, `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units) values ($1,'Exp house',$2,$3,'Bedsitter',3000,0,2,2) returning id`, [e, town.county_id, town.id])).id;
    for (let p = 0; p < 3; p++) await sql(db, "insert into house_photos(house_id,position,storage_path) values ($1,$2,'x')", [h, p]);
    assert.ok((await as(db, anon, "select id from public_listings")).some((r) => r.id === h));
    await sql(db, "update subscriptions set period_end = current_date - 1 where landlord_id=$1", [e]);
    assert.ok((await as(db, server, "select expire_subscriptions() n"))[0].n >= 1);
    assert.equal(await state(e), "expired");
    assert.ok(!(await as(db, anon, "select id from public_listings")).some((r) => r.id === h));
    assert.equal((await as(db, user(e), "select 1 from houses")).length, 0);
    await as(db, server, "select activate_subscription($1,'MPESAEXP2',1000)", [e]);            // paying again restores everything
    assert.equal(await state(e), "active");
    assert.equal((await as(db, user(e), "select 1 from houses")).length, 1);
  });
  it("only the admin can suspend or resume, with a reason and a full M-Pesa reference", async () => {
    const s = await mkUser(db, "sus@x.ke");
    await sql(db, "update profiles set landlord_state='kyc_approved' where id=$1", [s]);
    await as(db, server, "select activate_subscription($1,'MPESASUS1',1000)", [s]);
    await rejects(as(db, user(s), "select admin_suspend_landlord($1,'self')", [s]), /Not allowed/);
    await rejects(as(db, user(admin), "select admin_suspend_landlord($1,' ')", [s]), /reason is required/);
    await as(db, user(admin), "select admin_suspend_landlord($1,'Unpaid for 9 days')", [s]);
    assert.equal(await state(s), "suspended");
    await rejects(as(db, user(admin), "select admin_resume_landlord($1,'SHORT',1000)", [s]), /full M-Pesa reference/);
    await rejects(as(db, user(admin), "select admin_resume_landlord($1,'MPESARES1',500)", [s]), /below the monthly price/);
    await rejects(as(db, user(s), "select admin_resume_landlord($1,'MPESARES1',1000)", [s]), /Not allowed/);
    await as(db, user(admin), "select admin_resume_landlord($1,'mpesares1',1000)", [s]);
    assert.equal(await state(s), "active");
    assert.equal((await one(db, "select recorded_by from subscription_payments where provider_ref='MPESARES1'")).recorded_by, admin);
    assert.ok((await as(db, user(admin), "select 1 from audit_log where entity='subscription'")).length >= 2);
  });
});

describe("houses, units and tenancies", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });
  const rent = (landlord, house, unit, t = "0711555001", e = "0722555001", extra = "") =>
    as(db, user(landlord), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day${extra ? "," + extra.split("=")[0] : ""})
      values ($1,$2,$3,'Tom','${t}','Emma','${e}','mum',6500,6500,5${extra ? "," + extra.split("=")[1] : ""}) returning id`, [landlord, house, unit]);

  it("moving a tenant in lowers vacant units, a full listing refuses more, and moving out restores it", async () => {
    const vac = async () => (await one(db, "select vacant_units v from houses where id=$1", [w.hA])).v;
    assert.equal(await vac(), 2);                                         // buildWorld moved one tenant into hA
    const [t2] = await rent(w.la, w.hA, "A2", "0711555002", "0722555002");
    const [t3] = await rent(w.la, w.hA, "A3", "0711555003", "0722555003");
    assert.equal(await vac(), 0);
    await rejects(rent(w.la, w.hA, "A4", "0711555004", "0722555004"), /No vacant units left/);
    await as(db, user(w.la), "update tenancies set status='ended' where id=$1", [t3.id]);
    assert.equal(await vac(), 1);
    assert.equal((await one(db, "select ended_on is not null as e from tenancies where id=$1", [t3.id])).e, true);
    await rejects(as(db, user(w.la), "update tenancies set status='active' where id=$1", [t3.id]), /cannot be reopened/);
    await as(db, user(w.la), "update tenancies set status='ended' where id=$1", [t2.id]);
    assert.equal(await vac(), 2);
    assert.ok((await one(db, "select count(*)::int n from audit_log where entity='house' and entity_id=$1", [w.hA])).n >= 4);
  });
  it("vacant units stay between zero and the total", async () => {
    await rejects(as(db, user(w.la), "update houses set vacant_units=99 where id=$1", [w.hA]), /vacant_in_range/);
    await rejects(as(db, user(w.la), "update houses set vacant_units=-1 where id=$1", [w.hA]), /vacant_in_range/);
    await as(db, user(w.la), "update houses set vacant_units=1 where id=$1", [w.hA]);
    await as(db, user(w.la), "update houses set vacant_units=2 where id=$1", [w.hA]);
  });
  it("tenant records need valid phones, and the emergency contact must be someone else", async () => {
    await rejects(rent(w.la, w.hA, "P1", "0711555009", "0711555009"), /check constraint/);
    await rejects(rent(w.la, w.hA, "P2", "12345", "0722555009"), /check constraint/);
    await rejects(rent(w.la, w.hA, "A1", "0711555010", "0722555010"), /duplicate key|one_active_unit/);        // unit A1 is already occupied
  });
  it("electricity details must be complete before the tenant sees them", async () => {
    await rejects(as(db, user(w.la), "update tenancies set electricity_enabled=true where id=$1", [w.tA]), /check constraint/);
    await rejects(as(db, user(w.la), "update tenancies set electricity_enabled=true, kplc_paybill='12', meter_number='x' where id=$1", [w.tA]), /check constraint/);
    await as(db, user(w.la), "update tenancies set electricity_enabled=true, kplc_paybill='888880', meter_number='14200001234' where id=$1", [w.tA]);
    assert.equal((await as(db, user(w.ta), "select electricity_enabled e from tenancies"))[0].e, true);
  });
  it("at most seven photos per house, one per position", async () => {
    for (let p = 3; p < 7; p++) await as(db, user(w.la), "insert into house_photos(house_id,position,storage_path) values ($1,$2,'x')", [w.hA, p]);
    await rejects(as(db, user(w.la), "insert into house_photos(house_id,position,storage_path) values ($1,7,'x')", [w.hA]), /check constraint/);
    await rejects(as(db, user(w.la), "insert into house_photos(house_id,position,storage_path) values ($1,0,'x')", [w.hA]), /duplicate key/);
    await rejects(as(db, user(w.lb), "insert into house_photos(house_id,position,storage_path) values ($1,0,'x')", [w.hA]), /row-level security|duplicate key/);
  });
  it("a landlord cannot reassign ownership of houses or tenants", async () => {
    await rejects(as(db, user(w.la), "update houses set landlord_id=$1 where id=$2", [w.lb, w.hA]), /permission denied/);
    await rejects(as(db, user(w.la), "update tenancies set tenant_user_id=$1 where id=$2", [w.tb, w.tA]), /permission denied/);
    await rejects(as(db, user(w.la), "update tenancies set landlord_id=$1 where id=$2", [w.lb, w.tA]), /permission denied/);
  });
});

describe("viewing requests", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });
  const req = (house, phone, dateExpr = "current_date + 1") =>
    as(db, server, `select create_visit_request($1,'Faith Njeri',$2,${dateExpr},'Morning') id`, [house, phone]);

  it("visitors must pick a date inside the next 7 days, for a house that is available", async () => {
    assert.ok((await req(w.hA, "0711666001"))[0].id);
    await rejects(req(w.hA, "0711666002", "current_date + 8"), /within the next 7 days/);
    await rejects(req(w.hA, "0711666002", "current_date - 1"), /within the next 7 days/);
    await rejects(req(w.hA2, "0711666003"), /not available/);
  });
  it("flood protection: three open requests per phone, five per house", async () => {
    await req(w.hA, "0711666001"); await req(w.hA, "0711666001");
    await rejects(req(w.hB, "0711666001"), /Too many open requests for this number/);
    for (let i = 1; i <= 5; i++) await req(w.hB, `07117770${String(i).padStart(2, "0")}`);
    await rejects(req(w.hB, "0711777099"), /full for this house/);
  });
  it("browsers cannot create or read requests directly", async () => {
    await rejects(as(db, anon, "insert into visit_requests(house_id,visitor_name,visitor_phone,preferred_date,time_window) values ($1,'x y','0711000000',current_date,'Morning')", [w.hA]), /permission denied/);
    await rejects(as(db, user(w.la), "insert into visit_requests(house_id,visitor_name,visitor_phone,preferred_date,time_window) values ($1,'x y','0711000000',current_date,'Morning')", [w.hA]), /permission denied/);
    assert.equal((await as(db, anon, "select 1 from public_listings")).length > 0, true);
  });
  it("landlords see new requests for their house so they can contact visitors", async () => {
    const [{ id }] = await as(db, server, "select create_visit_request($1,'Faith Njeri','0711666010',current_date+1,'Morning') id", [w.hA]);
    assert.equal((await as(db, user(w.la), "select 1 from visit_requests where id=$1", [id])).length, 1);
    assert.equal((await as(db, user(w.lb), "select 1 from visit_requests where id=$1", [id])).length, 0);
    assert.ok((await as(db, user(w.admin), "select 1 from visit_requests")).length > 0);
    await as(db, user(w.admin), "update visit_requests set status='contacted' where id=$1", [id]);
    await as(db, user(w.admin), "update visit_requests set status='scheduled', scheduled_date=current_date+2, scheduled_window='Morning' where id=$1", [id]);
    assert.equal((await as(db, user(w.la), "select 1 from visit_requests where id=$1", [id])).length, 1);
    assert.equal((await as(db, user(w.lb), "select 1 from visit_requests where id=$1", [id])).length, 0);
    await rejects(as(db, user(w.la), "update visit_requests set status='done' where id=$1", [id]), /permission denied|row-level/).catch(async () => {
      assert.equal((await as(db, user(w.la), "update visit_requests set status='done' where id=$1 returning id", [id])).length, 0);
    });
  });
  it("rescheduling: only the owner, only scheduled viewings, inside the week, at most twice", async () => {
    const [{ id }] = await sql(db, "select id from visit_requests where status='scheduled' limit 1");
    await rejects(as(db, user(w.lb), "select reschedule_visit($1,current_date+3,'Evening')", [id]), /Viewing not found/);
    await rejects(as(db, user(w.la), "select reschedule_visit($1,current_date+9,'Evening')", [id]), /within the next 7 days/);
    await rejects(as(db, user(w.la), "select reschedule_visit($1,current_date+3,'Midnight')", [id]), /Invalid time window/);
    await as(db, user(w.la), "select reschedule_visit($1,current_date+3,'Evening')", [id]);
    await as(db, user(w.la), "select reschedule_visit($1,current_date+4,'Morning')", [id]);
    await rejects(as(db, user(w.la), "select reschedule_visit($1,current_date+5,'Morning')", [id]), /Maximum 2 reschedules/);
    const v = await one(db, "select status, reschedule_count c from visit_requests where id=$1", [id]);
    assert.deepEqual(v, { status: "rescheduled", c: 2 });
    const [{ id: fresh }] = await sql(db, "select id from visit_requests where status='new' limit 1");
    await rejects(as(db, user(w.la), "select reschedule_visit($1,current_date+3,'Morning')", [fresh]), /Viewing not found|Only scheduled/);
  });
});

describe("SMS wallet", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });
  const charge = async (segments, tpl = "broadcast") => (await as(db, server, "select sms_charge($1,$2,'0711000001','hello',$3) id", [w.la, tpl, segments]))[0].id;
  const bal = async () => Number((await one(db, "select balance_kes b from sms_wallets where landlord_id=$1", [w.la])).b);

  it("at zero balance the message fails and nothing is debited", async () => {
    const id = await charge(1);
    assert.deepEqual(await one(db, "select status, cost_kes::float c from sms_messages where id=$1", [id]), { status: "paused_insufficient_balance", c: 0 });
    assert.equal(await bal(), 0);
  });
  it("recharging is idempotent, and each segment costs KES 0.80", async () => {
    await as(db, server, "select sms_recharge($1,10,'RECH0001')", [w.la]);
    await as(db, server, "select sms_recharge($1,10,'RECH0001')", [w.la]);
    assert.equal(await bal(), 10);
    const id = await charge(2);
    assert.equal(await bal(), 8.4);
    assert.deepEqual(await one(db, "select status, cost_kes::float c from sms_messages where id=$1", [id]), { status: "queued", c: 1.6 });
  });
  it("the balance can never go negative", async () => {
    const id = await charge(11);                         // 8.80 is more than the 8.40 left
    assert.equal((await one(db, "select status from sms_messages where id=$1", [id])).status, "paused_insufficient_balance");
    assert.equal(await bal(), 8.4);
    await rejects(sql(db, "update sms_wallets set balance_kes=-1"), /check constraint/);
  });
  it("a message Celcom rejects is refunded exactly once", async () => {
    const id = await charge(1); assert.equal(await bal(), 7.6);
    await as(db, server, "select sms_provider_failed($1)", [id]); assert.equal(await bal(), 8.4);
    await as(db, server, "select sms_provider_failed($1)", [id]); assert.equal(await bal(), 8.4);
  });
  it("landlords can read their own wallet but never change it", async () => {
    assert.equal((await as(db, user(w.la), "select 1 from sms_wallets")).length, 1);
    assert.equal((await as(db, user(w.lb), "select 1 from sms_wallets where landlord_id=$1", [w.la])).length, 0);
    await rejects(as(db, user(w.la), "update sms_wallets set balance_kes=999"), /permission denied/);
    await rejects(as(db, user(w.la), "insert into sms_recharges(landlord_id,amount_kes,provider_ref) values ($1,500,'FAKE')", [w.la]), /permission denied/);
  });
});

describe("tenant features: complaints, emergency contact, notices", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("a tenant files a complaint; the landlord and assigned caretaker see it; nobody else does", async () => {
    const [{ id }] = await as(db, user(w.ta), "insert into complaints(tenancy_id,category,title) values ($1,'Water','No water since morning') returning id", [w.tA]);
    assert.equal((await one(db, "select landlord_id from complaints where id=$1", [id])).landlord_id, w.la);   // set by the database, not the browser
    assert.equal((await as(db, user(w.la), "select 1 from complaints")).length, 1);
    assert.equal((await as(db, user(w.care), "select 1 from complaints")).length, 1);
    for (const who of [w.lb, w.tb, w.admin]) assert.equal((await as(db, user(who), "select 1 from complaints")).length, 0);
    await rejects(as(db, user(w.ta), "insert into complaints(tenancy_id,category,title) values ($1,'Water','For my neighbour')", [w.tB]), /row-level security/);
    await rejects(as(db, user(w.ta), "insert into complaints(tenancy_id,category,title,landlord_id) values ($1,'Water','Spoof',$2)", [w.tA, w.lb]), /permission denied/);
    assert.equal((await as(db, user(w.ta), "update complaints set status='resolved' where id=$1 returning id", [id])).length, 0);
    await as(db, user(w.la), "update complaints set status='in_progress', assigned_to=$2 where id=$1", [id, w.care]);
    assert.equal((await as(db, user(w.ta), "select status from complaints"))[0].status, "in_progress");
  });
  it("complaint messages are visible only to the people in that complaint, and cannot be forged", async () => {
    const [{ id }] = await sql(db, "select id from complaints limit 1");
    await as(db, user(w.ta), "insert into complaint_messages(complaint_id,author_id,body) values ($1,$2,'Still no water')", [id, w.ta]);
    await as(db, user(w.la), "insert into complaint_messages(complaint_id,author_id,body) values ($1,$2,'Plumber coming at 10')", [id, w.la]);
    await rejects(as(db, user(w.ta), "insert into complaint_messages(complaint_id,author_id,body) values ($1,$2,'Forged')", [id, w.la]), /row-level security/);
    await rejects(as(db, user(w.tb), "insert into complaint_messages(complaint_id,author_id,body) values ($1,$2,'Intruder')", [id, w.tb]), /row-level security/);
    assert.equal((await as(db, user(w.tb), "select 1 from complaint_messages")).length, 0);
    assert.equal((await as(db, user(w.ta), "select 1 from complaint_messages")).length, 2);
  });
  it("a tenant can update their own emergency contact, but it must stay a different person", async () => {
    await as(db, user(w.ta), "select update_my_emergency_contact('Grace Otieno','0733444555','mother')");
    assert.equal((await one(db, "select emergency_phone p from tenancies where id=$1", [w.tA])).p, "0733444555");
    assert.equal((await one(db, "select emergency_phone p from tenancies where id=$1", [w.tB])).p, "0722000002");   // other tenants untouched
    await rejects(as(db, user(w.ta), "select update_my_emergency_contact('Me','0711000001','self')"), /check constraint/);
    await rejects(as(db, user(w.care), "select update_my_emergency_contact('X Y','0733444556','friend')"), /Tenancy not found/);
  });
  it("notices reach only the tenants of the landlord who posted them", async () => {
    await as(db, user(w.la), "insert into notices(landlord_id,title,body) values ($1,'Water shutdown','Thursday 9am to 1pm')", [w.la]);
    assert.equal((await as(db, user(w.ta), "select 1 from notices")).length, 1);
    assert.equal((await as(db, user(w.tb), "select 1 from notices")).length, 0);
    await rejects(as(db, user(w.ta), "insert into notices(landlord_id,title,body) values ($1,'Fake','x')", [w.la]), /row-level security/);
  });
});
