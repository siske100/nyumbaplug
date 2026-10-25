import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, server, mkUser, sql, rejects, buildWorld } from "./helpers.mjs";

const one = async (db, text, params) => (await sql(db, text, params))[0];
const count = async (db, who, table, where = "true", params = []) => (await as(db, who, `select count(*)::int n from ${table} where ${where}`, params))[0].n;

describe("admin access needs the authenticator code", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("a password-only admin session opens nothing; a verified one opens the admin area", async () => {
    const pwOnly = user(w.admin, "aal1"), full = user(w.admin, "aal2");
    assert.equal((await as(db, pwOnly, "select is_admin() a"))[0].a, false);
    assert.equal((await as(db, full, "select is_admin() a"))[0].a, true);
    assert.equal(await count(db, pwOnly, "admin_landlord_overview"), 0);
    assert.equal(await count(db, full, "admin_landlord_overview"), 2);
    assert.equal(await count(db, pwOnly, "profiles", "role='landlord'"), 0);
    await rejects(as(db, pwOnly, "select admin_suspend_landlord($1,'test')", [w.la]), /Not allowed/);
    await rejects(as(db, pwOnly, "select admin_celcom_topup(500,'REF1')"), /Not allowed/);
  });
  it("only admins can use the admin views, whatever their session level", async () => {
    for (const v of ["admin_kyc_queue", "admin_subscription_payments", "admin_celcom_balance", "admin_sms_month", "admin_viewings", "admin_landlord_overview"]) {
      assert.equal(await count(db, user(w.la), v), 0, `${v} must be empty for a landlord`);
      assert.equal(await count(db, user(w.ta), v), 0, `${v} must be empty for a tenant`);
    }
  });
  it("the overview tallies houses to the monthly price and carries no tenant data", async () => {
    const rows = await as(db, user(w.admin), "select * from admin_landlord_overview order by full_name nulls last");
    assert.ok(rows.every((r) => !Object.keys(r).some((k) => /tenant|rent|ledger|complaint/i.test(k))));
    const a = rows.find((r) => r.landlord_id === w.la);
    assert.deepEqual({ units: a.units, price: a.monthly_price }, { units: 6, price: 1000 });   // hA has 4 units and hA2 has 2
  });
});

describe("documents queue and subscription payments", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("the admin sees submissions with the landlord's details; landlords see only their own submission rows", async () => {
    await sql(db, "update profiles set landlord_state='pending_kyc', full_name='Wanjiku Kamau' where id=$1", [w.la]);
    await as(db, user(w.la), "select submit_kyc('29876543','A009876543K',$1,$2,$3)", [`${w.la}/a.jpg`, `${w.la}/b.jpg`, `${w.la}/c.pdf`]);
    const q = await as(db, user(w.admin), "select * from admin_kyc_queue");
    assert.equal(q.length, 1);
    assert.deepEqual({ n: q[0].full_name, id: q[0].national_id, s: q[0].status }, { n: "Wanjiku Kamau", id: "29876543", s: "pending" });
    assert.equal(await count(db, user(w.lb), "kyc_submissions"), 0);
  });
  it("subscription payments are visible to the admin with the landlord's name, and to nobody else", async () => {
    await as(db, user(w.admin), "select review_kyc($1,true)", [q0(await sql(db, "select id from kyc_submissions limit 1"))]);
    await as(db, server, "select activate_subscription($1,'MPESAAAA1',1000)", [w.la]);
    const rows = await as(db, user(w.admin), "select * from admin_subscription_payments");
    assert.deepEqual({ name: rows[0].full_name, amount: rows[0].amount_kes, ref: rows[0].provider_ref }, { name: "Wanjiku Kamau", amount: 1000, ref: "MPESAAAA1" });
    assert.equal(await count(db, user(w.lb), "admin_subscription_payments"), 0);
  });
});
const q0 = (rows) => rows[0].id;

describe("subscription reminders", () => {
  let db, w;
  const claim = (admin, landlord) => as(db, server, "select claim_subscription_reminder($1,$2) r", [admin, landlord]);
  before(async () => { db = await freshDb(); w = await buildWorld(db); await sql(db, "update profiles set phone='0712345678', email_verified=true, phone_verified=false, full_name='Wanjiku Kamau' where id=$1", [w.la]); });

  it("returns what the message needs, once a day", async () => {
    const [{ r }] = await claim(w.admin, w.la);
    assert.deepEqual({ name: r.name, phone: r.phone, price: r.price, state: r.state }, { name: "Wanjiku Kamau", phone: "0712345678", price: 1000, state: "active" });
    await rejects(claim(w.admin, w.la), /already sent in the last 24 hours/);
  });
  it("a reminder that failed to send does not count against the daily limit", async () => {
    await as(db, server, "select finish_subscription_reminder($1,false)", [(await sql(db, "select id from subscription_reminders limit 1"))[0].id]);
    const [{ r }] = await claim(w.admin, w.la);
    await as(db, server, "select finish_subscription_reminder($1,true)", [r.reminder_id]);
    assert.ok((await as(db, user(w.admin), "select last_reminder_at from admin_landlord_overview where landlord_id=$1", [w.la]))[0].last_reminder_at);
    await rejects(claim(w.admin, w.la), /already sent/);
  });
  it("requires a verified email and saved phone, and only reminds active or expired landlords", async () => {
    await rejects(claim(w.admin, w.lb), /no verified email or phone/);
    await sql(db, "update profiles set email_verified=true, phone=null where id=$1", [w.lb]);
    await rejects(claim(w.admin, w.lb), /no verified email or phone/);
    await sql(db, "update profiles set phone='0722000000', landlord_state='suspended' where id=$1", [w.lb]);
    await rejects(claim(w.admin, w.lb), /only for active or expired/);
    await rejects(claim(w.admin, w.ta), /Landlord not found/);
  });
  it("browsers cannot send or read reminders", async () => {
    await rejects(as(db, user(w.admin), "select claim_subscription_reminder($1,$2)", [w.admin, w.la]), /permission denied/);
    await rejects(as(db, user(w.admin), "select * from subscription_reminders"), /permission denied/);
  });
});

describe("platform SMS credit (Celcom)", () => {
  let db, w;
  const bal = async () => (await as(db, user(w.admin), "select * from admin_celcom_balance"))[0];
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("starts empty and flags itself as low", async () => {
    const b = await bal();
    assert.deepEqual({ balance: Number(b.balance), low: b.low }, { balance: 0, low: true });
  });
  it("top-ups need the admin, a positive amount and a reference, and a reference works once", async () => {
    await rejects(as(db, user(w.la), "select admin_celcom_topup(1000,'REF-1')"), /Not allowed/);
    await rejects(as(db, user(w.admin), "select admin_celcom_topup(0,'REF-1')"), /Enter the amount/);
    await rejects(as(db, user(w.admin), "select admin_celcom_topup(1000,'x')"), /payment reference/);
    await as(db, user(w.admin), "select admin_celcom_topup(1000,'ref-1')");
    await rejects(as(db, user(w.admin), "select admin_celcom_topup(1000,'REF-1')"), /duplicate key/);
    const b = await bal();
    assert.deepEqual({ balance: Number(b.balance), low: b.low }, { balance: 1000, low: false });
  });
  it("each segment used costs KES 0.25, and only the server can record usage", async () => {
    await as(db, server, "select celcom_record_usage(2,'otp')");
    await as(db, server, "select celcom_record_usage(40,'reminder')");
    assert.equal(Number((await bal()).balance), 989.5);
    await rejects(as(db, user(w.admin), "select celcom_record_usage(1,'x')"), /permission denied/);
    await rejects(sql(db, "delete from celcom_ledger"), /append-only/);
    await rejects(sql(db, "update celcom_ledger set amount_kes=1"), /append-only/);
  });
  it("sold, cost and profit are totals only, and landlords cannot read the ledger", async () => {
    await sql(db, "insert into sms_messages(landlord_id,template,recipient,body,segments,cost_kes,status) values ($1,'broadcast','0711000001','secret text',10,8,'sent'),($1,'broadcast','0711000002','x',3,0,'paused_insufficient_balance')", [w.la]);
    const m = (await as(db, user(w.admin), "select * from admin_sms_month"))[0];
    assert.deepEqual({ seg: m.segments_sold, rev: Number(m.revenue_kes), cost: Number(m.cost_kes), profit: Number(m.profit_kes) }, { seg: 10, rev: 8, cost: 2.5, profit: 5.5 });
    assert.ok(!Object.keys(m).some((k) => /recipient|body|phone/i.test(k)));
    await rejects(as(db, user(w.la), "select * from celcom_ledger"), /permission denied/);
    assert.equal(await count(db, user(w.la), "admin_sms_month"), 0);
  });
});

describe("viewings in the admin queue", () => {
  let db, w, id;
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    id = (await as(db, server, "select create_visit_request($1,'Faith Njeri','0711666001',current_date + 1,'Morning') id", [w.hA]))[0].id;
  });
  const set = (sqlText, params = []) => as(db, user(w.admin), `update visit_requests set ${sqlText} where id=$1`, [id, ...params]);

  it("the admin sees the house and landlord with each request; others do not", async () => {
    const v = (await as(db, user(w.admin), "select * from admin_viewings"))[0];
    assert.deepEqual({ house: v.house_title, status: v.status }, { house: "Block A", status: "new" });
    assert.equal(await count(db, user(w.la), "admin_viewings"), 0);
  });
  it("a viewing moves forward only along real steps", async () => {
    await rejects(set("status='scheduled', scheduled_date=current_date+1, scheduled_window='Morning'"), /cannot move from new to scheduled/);
    await rejects(set("status='done'"), /cannot move from new to done/);
    await set("status='contacted'");
    await rejects(set("status='scheduled'"), /Pick a date within the next 7 days/);
    await rejects(set("status='scheduled', scheduled_date=current_date+9, scheduled_window='Morning'"), /Pick a date/);
    await rejects(set("status='scheduled', scheduled_date=current_date-1, scheduled_window='Morning'"), /Pick a date/);
    await set("status='scheduled', scheduled_date=current_date+2, scheduled_window='Afternoon'");
    await set("status='done'");
  });
  it("finished viewings are locked", async () => {
    for (const s of ["new", "contacted", "scheduled", "cancelled", "no_show"]) await rejects(set(`status='${s}'`), /cannot move from done/);
  });
  it("the admin can add notes but cannot change the visitor's details", async () => {
    await set("admin_notes='Called, will come at 10'");
    await rejects(set("visitor_phone='0799000000'"), /permission denied/);
    await rejects(set("house_id=house_id"), /permission denied/);
  });
  it("a house the landlord says is gone can be closed straight from new or contacted", async () => {
    const other = (await as(db, server, "select create_visit_request($1,'Amina Hassan','0711666002',current_date + 1,'Evening') id", [w.hA]))[0].id;
    await as(db, user(w.admin), "update visit_requests set status='house_taken' where id=$1", [other]);
    assert.equal((await one(db, "select status from visit_requests where id=$1", [other])).status, "house_taken");
  });
});
