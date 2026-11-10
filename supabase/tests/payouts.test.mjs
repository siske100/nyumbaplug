import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, sql, rejects, buildWorld, mkUser } from "./helpers.mjs";

describe("system collection: custody, payout on request, admin", () => {
  let db, w, hBig, n = 0;
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    hBig = (await sql(db, `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
      values ($1,'Big',39,(select id from towns where name='Bungoma Town'),'Bedsitter',6500,6500,50,50) returning id`, [w.la]))[0].id;
  });
  const tenancy = async (landlord = w.la) => {
    n++;
    const t = (await as(db, user(landlord), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
      values ($1,$2,'Q${n}','Tenant','07118${String(n).padStart(5, "0")}','Emma','07228${String(n).padStart(5, "0")}','mum',6500,6500,5) returning id, tenancy_code`, [landlord, hBig]))[0];
    await sql(db, "insert into charges(tenancy_id,landlord_id,period_year,period_month,amount) values ($1,$2,2026,10,6500)", [t.id, landlord]);
    return t;
  };
  /** The tenant pays HousePlug Kenya (a confirmed M-Pesa prompt). */
  const collect = async (t) => {
    const co = "ws_CO_" + Math.random();
    await as(db, server, "select start_payment_attempt($1,'0711000001',$2,'mr')", [t.id, co]);
    return (await as(db, server, "select confirm_payment($1,$2,6500,'0711000001') id", [co, "RCPT" + Math.random().toString(36).slice(2, 10).toUpperCase()]))[0].id;
  };
  const summary = async (who) => (await as(db, user(who), "select my_payout_summary() s"))[0].s;
  const setDest = (who, kind, dest, ref = null) => as(db, user(who), `insert into payout_destinations(landlord_id,kind,destination,account_ref) values ($1,$2,$3,$4)
    on conflict (landlord_id) do update set kind=excluded.kind, destination=excluded.destination, account_ref=excluded.account_ref`, [who, kind, dest, ref]);
  const age = (who) => sql(db, "update payout_destinations set updated_at = now() - interval '2 days' where landlord_id=$1", [who]);

  it("where a landlord is paid is validated by kind: M-Pesa phone, till, or paybill with an account", async () => {
    await rejects(setDest(w.la, "mpesa_phone", "12345"), /payout_destinations_shape_check|violates check/);
    await rejects(setDest(w.la, "till", "12"), /violates check/);
    await rejects(setDest(w.la, "paybill", "522522"), /violates check/);                 // a paybill needs the account number
    await rejects(setDest(w.la, "paybill", "522522", "bad;ref"), /violates check/);
    await rejects(setDest(w.la, "bank_paybill", "522522", "123"), /violates check/);
    await setDest(w.la, "mpesa_phone", "0711000001");
    await setDest(w.lb, "paybill", "522522", "1234567890");
    assert.deepEqual((await as(db, user(w.la), "select kind, destination from payout_destinations"))[0], { kind: "mpesa_phone", destination: "0711000001" });
    assert.equal((await as(db, user(w.la), "select * from payout_destinations")).length, 1);                // a landlord sees only their own
    await rejects(as(db, user(w.la), "update payout_destinations set landlord_id=$1", [w.lb]), /permission denied/);
    assert.ok((await sql(db, "select 1 from audit_log where action='payout_destination_changed'")).length >= 2);
  });
  it("a landlord who has not said where to be paid cannot choose HousePlug Kenya collection; tenants are routed once they have", async () => {
    await sql(db, "delete from payout_destinations where landlord_id=$1", [w.la]);
    await rejects(as(db, user(w.la), "select set_payment_mode('platform')"), /Add where you want to be paid/);
    await setDest(w.la, "mpesa_phone", "0711000001");
    await as(db, user(w.la), "select set_payment_mode('platform')");
    await sql(db, "update tenancies set tenant_user_id=$1 where id=$2", [w.ta, w.tA]);
    assert.equal((await as(db, user(w.ta), "select tenant_payment_route() r"))[0].r, "platform");
  });
  it("rent collected by HousePlug Kenya is the landlord's available money; manual bank transfers and reversed payments are not", async () => {
    const before = (await summary(w.la)).available;
    const t1 = await tenancy(), t2 = await tenancy();
    const e1 = await collect(t1), e2 = await collect(t2);
    assert.equal((await summary(w.la)).available, before + 13000);
    await sql(db, "insert into ledger_entries(tenancy_id,landlord_id,kind,bucket,amount,method,provider_ref) values ($1,$2,'rent_payment','rent',6500,'manual_transfer','MANUAL-PAYOUT')", [w.tA, w.la]);
    assert.equal((await summary(w.la)).available, before + 13000);                         // bank money never passed through HousePlug Kenya
    await as(db, user(w.la), "select reverse_payment($1,'Paid by mistake')", [e2]);
    assert.equal((await summary(w.la)).available, before + 6500);
    void e1;
  });
  it("a payout cannot be requested until the destination is a day old, below the minimum, or by a stranger", async () => {
    await rejects(as(db, user(w.la), "select request_payout()"), /24 hours after you change/);
    await age(w.la); await age(w.lb);
    await rejects(as(db, user(w.lb), "select request_payout()"), /minimum payout is KES 100/);       // lb has collected nothing
    await rejects(as(db, anon, "select request_payout()"), /permission denied/);
    await rejects(as(db, user(w.ta), "select request_payout()"), /not active/);
  });
  it("one request takes everything available, once; the money cannot be asked for again while it waits", async () => {
    const avail = (await summary(w.la)).available;
    assert.ok(avail >= 6500);
    const [{ request_payout: pid }] = await as(db, user(w.la), "select request_payout()");
    assert.ok(pid);
    const p = (await as(db, user(w.la), "select amount, status, destination_kind, destination from payouts"))[0];
    assert.deepEqual(p, { amount: avail, status: "scheduled", destination_kind: "mpesa_phone", destination: "0711000001" });
    const s = await summary(w.la);
    assert.deepEqual({ available: s.available, requested: s.requested }, { available: 0, requested: avail });
    await rejects(as(db, user(w.la), "select request_payout()"), /already have a payout waiting/);
    assert.equal((await as(db, user(w.lb), "select id from payouts")).length, 0);                    // other landlords never see it
    await rejects(as(db, user(w.la), "update payouts set status='paid'"), /permission denied/);
  });
  it("changing where a landlord is paid starts a new 24-hour wait, so a stolen account cannot cash out at once", async () => {
    await setDest(w.la, "till", "600123");
    await rejects(as(db, user(w.la), "select request_payout()"), /24 hours after you change/);
    await setDest(w.la, "till", "600123");                                                          // saving the same details again changes nothing
    assert.ok((await summary(w.la)).opensAt);
    await age(w.la);
  });
  it("the admin sees who to pay and where, records a failure with a reason, and the money becomes available again", async () => {
    const view = (await as(db, user(w.admin), "select * from admin_payouts"))[0];
    assert.equal(view.status, "scheduled"); assert.equal(view.destination, "0711000001"); assert.ok(view.destination_changed_at);
    assert.equal((await as(db, user(w.lb), "select * from admin_payouts")).length, 0);
    await rejects(as(db, user(w.la), "select admin_fail_payout($1,'no reason given')", [view.id]), /Not allowed/);
    await rejects(as(db, user(w.admin), "select admin_fail_payout($1,'no')", [view.id]), /Say why/);
    await as(db, user(w.admin), "select admin_fail_payout($1,'M-Pesa rejected the phone number')", [view.id]);
    const after = await summary(w.la);
    assert.equal(after.requested, 0); assert.equal(after.available, view.amount);                    // released, not lost
    assert.equal((await as(db, user(w.la), "select failure_reason from payouts"))[0].failure_reason, "M-Pesa rejected the phone number");
    await rejects(as(db, user(w.admin), "select admin_mark_payout_paid($1,'MPESAREF99')", [view.id]), /not found or already paid/);
  });
  it("a new request pays the released money, the admin records the M-Pesa reference once, and it can never be paid out twice", async () => {
    await as(db, user(w.la), "select request_payout()");
    const p = (await as(db, user(w.admin), "select * from admin_payouts where status='scheduled'"))[0];
    await rejects(as(db, user(w.la), "select admin_mark_payout_paid($1,'MPESAREF01')", [p.id]), /Not allowed/);
    await rejects(as(db, user(w.admin), "select admin_mark_payout_paid($1,'SHORT')", [p.id]), /full M-Pesa reference/);
    await as(db, user(w.admin), "select admin_mark_payout_paid($1,'mpesaref01')", [p.id]);
    await rejects(as(db, user(w.admin), "select admin_mark_payout_paid($1,'MPESAREF02')", [p.id]), /already paid/);
    await rejects(as(db, user(w.admin), "select admin_fail_payout($1,'too late to fail')", [p.id]), /not found or already settled/);
    const s = await summary(w.la);
    assert.deepEqual({ available: s.available, requested: s.requested, paidOut: s.paidOut }, { available: 0, requested: 0, paidOut: p.amount });
    await rejects(as(db, user(w.la), "select request_payout()"), /minimum payout is KES 100/);
    const items = await sql(db, "select i.ledger_entry_id from payout_items i join payouts p on p.id=i.payout_id where p.status <> 'failed' group by i.ledger_entry_id having count(*) > 1");
    assert.deepEqual(items, []);
    await rejects(sql(db, "insert into payout_items(payout_id, ledger_entry_id) select $1, ledger_entry_id from payout_items limit 1", [p.id]), /already been paid out/);
    await rejects(sql(db, "delete from payout_items"), /append-only/);
  });
  it("customer care sees what HousePlug Kenya owes landlords, what awaits payout, what was paid, and what it is holding", async () => {
    const t = await tenancy(); await collect(t);
    const c = (await as(db, user(w.admin), "select admin_custody_summary() c"))[0].c;
    assert.ok(c.owedToLandlords >= 6500); assert.ok(c.paidOut > 0); assert.equal(c.awaitingPayout, 0);
    await rejects(as(db, user(w.la), "select admin_custody_summary()"), /Not allowed/);
    await as(db, server, "select record_c2b_payment('GHOST999',4000,'GHOSTREC01','0733000000')");
    const held = (await as(db, user(w.admin), "select * from admin_held_payments where provider_ref='GHOSTREC01'"))[0];
    assert.deepEqual({ amount: held.amount, reason: held.reason, msisdn: held.msisdn }, { amount: 4000, reason: "unknown_account", msisdn: undefined });   // the admin never sees the payer's phone
    assert.equal((await as(db, user(w.admin), "select admin_custody_summary() c"))[0].c.heldUnmatched >= 4000, true);
    await rejects(as(db, user(w.admin), "select admin_close_held_payment($1,'ok')", [held.id]), /Record what was done/);
    await as(db, user(w.admin), "select admin_close_held_payment($1,'Refunded in M-Pesa, ref QWE123RTY4')", [held.id]);
    assert.equal((await as(db, user(w.admin), "select * from admin_held_payments where provider_ref='GHOSTREC01'")).length, 0);
    await rejects(as(db, user(w.la), "select admin_close_held_payment($1,'Refunded already')", [held.id]), /Not allowed/);
    assert.equal((await as(db, user(w.la), "select * from admin_held_payments")).length, 0);
  });
  it("a landlord who switches to manual bank transfer can still withdraw what HousePlug Kenya already holds for them", async () => {
    const t = await tenancy(); await collect(t);
    const bank = (await sql(db, "insert into banks(name,paybill) values('Switch Bank','523400') returning id"))[0].id;
    await as(db, user(w.la), "select save_landlord_manual_bank_account($1,'123456789','Wanjiku A')", [bank]);
    await as(db, user(w.la), "select set_payment_mode('bank_paybill')");
    assert.ok((await summary(w.la)).available >= 6500);
    await as(db, user(w.la), "select request_payout()");
    await sql(db, "update payouts set status='paid', provider_ref='SWITCHPAID1', paid_at=now() where status='scheduled'");
    await as(db, user(w.la), "select set_payment_mode('platform')");
  });
  it("legacy platform-era entries are never paid out by mistake", async () => {
    const t = await tenancy();
    await sql(db, "insert into ledger_entries(tenancy_id,landlord_id,kind,bucket,amount,method,provider_ref) values ($1,$2,'rent_payment','rent',6500,'c2b','LEGACY-OLD')", [t.id, w.la]);
    assert.equal((await sql(db, "select custody from ledger_entries where provider_ref='LEGACY-OLD'"))[0].custody, "landlord");
    assert.equal((await summary(w.la)).available, 0);
  });
});
