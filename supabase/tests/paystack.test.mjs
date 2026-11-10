import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, sql, rejects, buildWorld } from "./helpers.mjs";

const ref = () => "RHPS-" + crypto.randomUUID();
const URL1 = "https://checkout.paystack.com/abc123";

describe("paystack: rent (collected by HousePlug Kenya and held for the landlord)", () => {
  let db, w, n = 0, hBig;
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    await sql(db, "insert into payout_destinations(landlord_id,kind,destination) values ($1,'mpesa_phone','0711000001')", [w.la]);
    hBig = (await sql(db, `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
      values ($1,'Big',39,(select id from towns where name='Bungoma Town'),'Bedsitter',6500,6500,50,50) returning id`, [w.la]))[0].id;
  });
  const tenancy = async () => {
    n++;
    const t = (await as(db, user(w.la), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
      values ($1,$2,'P${n}','Tenant','07110${String(n).padStart(5, "0")}','Emma','07220${String(n).padStart(5, "0")}','mum',6500,6500,5) returning id`, [w.la, hBig]))[0].id;
    await sql(db, "insert into charges(tenancy_id,landlord_id,period_year,period_month,amount) values ($1,$2,2026,10,6500)", [t, w.la]);
    return t;
  };
  const start = async (t, r = ref()) => ({ r, row: (await as(db, server, "select * from start_paystack_rent_attempt($1,$2,'0711000001')", [t, r]))[0] });
  const confirm = async (r, amount) => (await as(db, server, "select confirm_payment($1,$2,$3,'0711000001') id", [r, "PSK-" + r, amount]))[0].id;
  const balance = async (t) => (await sql(db, "select balance from tenancy_balances where tenancy_id=$1", [t]))[0].balance;

  it("a browser or a stranger can never call a Paystack money function", async () => {
    for (const fn of ["start_paystack_rent_attempt('" + w.tA + "','" + ref() + "','0711000001')", "paystack_attempt_lookup('x')", "pending_paystack_attempts()",
      "claim_payment_notice('" + crypto.randomUUID() + "')", "open_paystack_rent_attempt('" + w.tA + "')", "bind_paystack_checkout('tenant','" + crypto.randomUUID() + "','x','https://a.b/c')"]) {
      await rejects(as(db, user(w.la), `select * from ${fn}`), /permission denied/);
      await rejects(as(db, anon, `select * from ${fn}`), /permission denied/);
    }
  });
  it("the amount is the full balance, decided by the database, with the landlord and tenancy code returned", async () => {
    const t = await tenancy(); const { row } = await start(t);
    assert.equal(row.amount, 6500); assert.equal(row.landlord_id, w.la); assert.match(row.tenancy_code, /^[A-Z0-9]{8}$/);
  });
  it("no checkout can start unless the landlord collects through HousePlug Kenya and has said where to be paid", async () => {
    const t = await tenancy();
    await sql(db, "update payment_accounts set mode='bank_paybill' where landlord_id=$1", [w.la]);
    await rejects(start(t), /Tenancy not found/);
    await sql(db, "update payment_accounts set mode='platform' where landlord_id=$1", [w.la]);
    await sql(db, "delete from payout_destinations where landlord_id=$1", [w.la]);
    await rejects(start(t), /Tenancy not found/);
    await sql(db, "insert into payout_destinations(landlord_id,kind,destination) values ($1,'mpesa_phone','0711000001')", [w.la]);
    assert.ok((await start(t)).row);
  });
  it("refuses a malformed reference, a bad phone, nothing owed, and a tenancy that is not found", async () => {
    const t = await tenancy();
    await rejects(as(db, server, "select * from start_paystack_rent_attempt($1,'RHPS-nope','0711000001')", [t]), /Invalid payment reference/);
    await rejects(as(db, server, "select * from start_paystack_rent_attempt($1,$2,'0211000001')", [t, ref()]), /phone number/);
    await rejects(as(db, server, "select * from start_paystack_rent_attempt($1,$2,'0711000001')", [crypto.randomUUID(), ref()]), /Tenancy not found/);
    const { r } = await start(t); await confirm(r, 6500);
    await rejects(as(db, server, "select * from start_paystack_rent_attempt($1,$2,'0711000001')", [t, ref()]), /Nothing to pay/);
  });
  it("only one checkout can be open per tenancy, and it can be found again to re-open it", async () => {
    const t = await tenancy(); const { r } = await start(t);
    await rejects(start(t), /duplicate key|unique/);
    await as(db, server, "select bind_paystack_checkout('tenant',(select id from payment_attempts where checkout_request_id=$1),$1,$2)", [r, URL1]);
    const open = (await as(db, server, "select * from open_paystack_rent_attempt($1)", [t]))[0];
    assert.equal(open.reference, r); assert.equal(open.checkout_url, URL1); assert.equal(open.amount, 6500); assert.equal(open.balance, 6500);
    await rejects(as(db, server, "select bind_paystack_checkout('tenant',(select id from payment_attempts where checkout_request_id=$1),$1,'http://insecure.example/x')", [r]), /Invalid checkout address/);
  });
  it("a paid checkout credits the ledger once as money HousePlug Kenya holds for the landlord, even if confirmed twice", async () => {
    const t = await tenancy(); const { r } = await start(t);
    const id1 = await confirm(r, 6500); assert.ok(id1);
    assert.equal(await balance(t), 0);
    assert.equal(await confirm(r, 6500), id1);
    const rows = await sql(db, "select method, provider_ref, kind, amount, custody from ledger_entries where tenancy_id=$1", [t]);
    assert.deepEqual(rows, [{ method: "paystack", provider_ref: "PSK-" + r, kind: "rent_payment", amount: 6500, custody: "platform" }]);
    assert.equal((await sql(db, "select status from payment_attempts where checkout_request_id=$1", [r]))[0].status, "succeeded");
  });
  it("a different amount is held (as money HousePlug Kenya holds) and not credited", async () => {
    const t = await tenancy(); const { r } = await start(t);
    assert.equal(await confirm(r, 5000), null);
    assert.equal(await balance(t), 6500);
    assert.deepEqual(await sql(db, "select reason, amount, landlord_id, custody from held_payments where provider_ref=$1", ["PSK-" + r]),
      [{ reason: "amount_mismatch", amount: 5000, landlord_id: w.la, custody: "platform" }]);
  });
  it("a second payment for rent that is already paid is held as a duplicate for customer care to refund, never credited twice", async () => {
    const t = await tenancy(); const { r } = await start(t);
    await sql(db, "insert into ledger_entries(tenancy_id,landlord_id,kind,bucket,amount,method,provider_ref) values ($1,$2,'rent_payment','rent',6500,'manual_transfer','MANUAL-"+n+"')", [t, w.la]);
    assert.equal(await balance(t), 0);
    assert.equal(await confirm(r, 6500), null);
    assert.equal((await sql(db, "select reason from held_payments where provider_ref=$1", ["PSK-" + r]))[0].reason, "duplicate_payment");
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where tenancy_id=$1", [t]))[0].n, 1);
    const [h] = await as(db, user(w.la), "select id from held_payments where provider_ref=$1", ["PSK-" + r]);
    await rejects(as(db, user(w.la), "select resolve_held_payment($1,$2)", [h.id, t]), /Customer care will refund it/);
    assert.equal((await as(db, user(w.admin), "select count(*)::int n from admin_held_payments where provider_ref=$1", ["PSK-" + r]))[0].n, 1);
  });
  it("a checkout that was open when the landlord changed method is still credited: the tenant really paid", async () => {
    const t = await tenancy(); const { r } = await start(t);
    await sql(db, "update payment_accounts set mode='bank_paybill' where landlord_id=$1", [w.la]);
    assert.ok(await confirm(r, 6500));
    await sql(db, "update payment_accounts set mode='platform' where landlord_id=$1", [w.la]);
  });
  it("a checkout that timed out but was paid late is still credited", async () => {
    const t = await tenancy(); const { r } = await start(t);
    await as(db, server, "select fail_payment_attempt($1,1037,'Checkout was not completed')", [r]);
    assert.equal((await sql(db, "select status from payment_attempts where checkout_request_id=$1", [r]))[0].status, "timeout");
    assert.ok(await confirm(r, 6500));
    assert.equal(await balance(t), 0);
  });
  it("the lookup names the payer and the landlord, and the scheduled check sees open and recently timed-out checkouts", async () => {
    const t = await tenancy(); const { r } = await start(t);
    const look = (await as(db, server, "select paystack_attempt_lookup($1) l", [r]))[0].l;
    assert.equal(look.kind, "tenant"); assert.equal(look.landlord_id, w.la); assert.equal(look.amount, 6500); assert.equal(look.status, "pending");
    assert.equal(await as(db, server, "select paystack_attempt_lookup('RHPS-unknown') l").then((x) => x[0].l), null);
    await sql(db, "update payment_attempts set created_at = now() - interval '10 minutes' where checkout_request_id=$1", [r]);
    assert.ok((await as(db, server, "select * from pending_paystack_attempts()")).some((x) => x.reference === r));
    await as(db, server, "select fail_payment_attempt($1,1037,'x')", [r]);
    assert.ok((await as(db, server, "select * from pending_paystack_attempts()")).some((x) => x.reference === r));
    await sql(db, "update payment_attempts set created_at = now() - interval '3 days' where checkout_request_id=$1", [r]);
    assert.ok(!(await as(db, server, "select * from pending_paystack_attempts()")).some((x) => x.reference === r));
  });
  it("one 'payment received' text per payment, however often the provider repeats itself", async () => {
    const t = await tenancy(); const { r } = await start(t); const id = await confirm(r, 6500);
    assert.equal((await as(db, server, "select claim_payment_notice($1) c", [id]))[0].c, true);
    assert.equal((await as(db, server, "select claim_payment_notice($1) c", [id]))[0].c, false);
  });
});

describe("paystack: HousePlug Kenya purchases", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });
  const begin = async (purpose, amount) => {
    const id = (await as(db, server, "select start_platform_attempt($1,$2,$3,'0711000001',$4,null) id", [w.la, purpose, amount, "pending-" + crypto.randomUUID()]))[0].id;
    const r = ref();
    await as(db, server, "select bind_paystack_checkout('platform',$1,$2,$3)", [id, r, URL1]);
    return { id, r };
  };
  const confirm = async (r, amount) => (await as(db, server, "select confirm_platform_payment($1,$2,$3,'0711000001') ok", [r, "PSK-" + r, amount]))[0].ok;

  it("a paid subscription checkout activates the plan once", async () => {
    await sql(db, "update profiles set landlord_state='expired' where id=$1", [w.la]);
    const { r } = await begin("subscription", 1000);
    assert.equal(await confirm(r, 1000), true);
    assert.equal(await confirm(r, 1000), true);
    assert.equal((await sql(db, "select landlord_state s from profiles where id=$1", [w.la]))[0].s, "active");
    assert.equal((await sql(db, "select count(*)::int n from subscription_payments where provider_ref=$1", ["PSK-" + r]))[0].n, 1);
    const look = (await as(db, server, "select paystack_attempt_lookup($1) l", [r]))[0].l;
    assert.equal(look.kind, "platform"); assert.equal(look.payer_id, w.la); assert.equal(look.purpose, "subscription");
  });
  it("the subscription price is enforced before any checkout exists", async () => {
    await rejects(as(db, server, "select start_platform_attempt($1,'subscription',500,'0711000001',$2,null)", [w.la, "pending-" + crypto.randomUUID()]), /subscription is KES/);
  });
  it("SMS credit is added once, and the open checkout can be found again to re-open it", async () => {
    const { r } = await begin("sms_recharge", 500);
    const open = (await as(db, server, "select * from open_paystack_platform_attempt($1,'sms_recharge',null)", [w.la]))[0];
    assert.equal(open.reference, r); assert.equal(open.amount, 500); assert.equal(open.checkout_url, URL1);
    await confirm(r, 500); await confirm(r, 500);
    assert.equal(Number((await sql(db, "select balance_kes b from sms_wallets where landlord_id=$1", [w.la]))[0].b), 500);
    assert.equal((await as(db, server, "select * from open_paystack_platform_attempt($1,'sms_recharge',null)", [w.la])).length, 0);
  });
  it("a wrong amount is held and credits nothing", async () => {
    const { r } = await begin("sms_recharge", 200);
    assert.equal(await confirm(r, 100), false);
    assert.equal(Number((await sql(db, "select balance_kes b from sms_wallets where landlord_id=$1", [w.la]))[0].b), 500);
    assert.equal((await sql(db, "select reason from held_payments where provider_ref=$1", ["PSK-" + r]))[0].reason, "amount_mismatch");
  });
  it("a Paystack checkout that timed out but was paid late is honoured; a timed-out M-Pesa prompt is not", async () => {
    const late = await begin("sms_recharge", 100);
    await as(db, server, "select fail_platform_attempt($1,1037,'late')", [late.r]);
    assert.equal(await confirm(late.r, 100), true);
    assert.equal(Number((await sql(db, "select balance_kes b from sms_wallets where landlord_id=$1", [w.la]))[0].b), 600);
    const id = (await as(db, server, "select start_platform_attempt($1,'sms_recharge',150,'0711000001',$2,null) id", [w.la, "ws_CO_" + Math.random()]))[0].id;
    const co = (await sql(db, "select checkout_request_id c from platform_attempts where id=$1", [id]))[0].c;
    await as(db, server, "select fail_platform_attempt($1,1037,'late')", [co]);
    assert.equal((await as(db, server, "select confirm_platform_payment($1,'MPESALATE1',150,'0711000001') ok", [co]))[0].ok, false);
  });
  it("platform attempts for other people are invisible to a landlord", async () => {
    assert.equal((await as(db, user(w.lb), "select id from platform_attempts")).length, 0);
  });
});
