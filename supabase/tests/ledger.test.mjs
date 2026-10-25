import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, sql, rejects, buildWorld } from "./helpers.mjs";

describe("money", () => {
  let db, w, hBig, n = 0;
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    hBig = (await sql(db, `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
      values ($1,'Big',39,(select id from towns where name='Bungoma Town'),'Bedsitter',6500,6500,50,50) returning id`, [w.la]))[0].id;
  });

  /** A fresh tenancy with one KES 6,500 charge, owned by landlord A. */
  const tenancy = async (landlord = w.la, house = hBig) => {
    n++;
    const t = (await as(db, user(landlord), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
      values ($1,$2,'U${n}','Tenant','07110${String(n).padStart(5, "0")}','Emma','07220${String(n).padStart(5, "0")}','mum',6500,6500,5) returning id, tenancy_code`, [landlord, house]))[0];
    await sql(db, "insert into charges(tenancy_id,landlord_id,period_year,period_month,amount) values ($1,$2,2026,10,6500)", [t.id, landlord]);
    return t;
  };
  const balance = async (t) => (await sql(db, "select balance from tenancy_balances where tenancy_id=$1", [t]))[0].balance;
  const attempt = async (t) => (await as(db, server, "select start_payment_attempt($1,'0711000001',$2,'mr') id", [t, "ws_CO_" + Math.random()]))[0].id;
  const checkoutOf = async (a) => (await sql(db, "select checkout_request_id c from payment_attempts where id=$1", [a]))[0].c;
  const confirm = async (co, receipt, amount) => (await as(db, server, "select confirm_payment($1,$2,$3,'0711000001') id", [co, receipt, amount]))[0].id;

  it("a full M-Pesa payment is recorded once, even if Safaricom calls back twice", async () => {
    const t = await tenancy(); const a = await attempt(t.id); const co = await checkoutOf(a);
    const id1 = await confirm(co, "RCPT0001A", 6500);
    assert.ok(id1);
    assert.equal(await balance(t.id), 0);
    const id2 = await confirm(co, "RCPT0001A", 6500);
    assert.equal(id2, id1);
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where tenancy_id=$1", [t.id]))[0].n, 1);
    assert.equal((await sql(db, "select status from payment_attempts where id=$1", [a]))[0].status, "succeeded");
  });
  it("the amount asked for is the full balance, never a partial", async () => {
    const t = await tenancy();
    const a = await attempt(t.id);
    assert.equal((await sql(db, "select expected_amount e from payment_attempts where id=$1", [a]))[0].e, 6500);
  });
  it("a payment of the wrong amount is held for the landlord, not credited", async () => {
    const t = await tenancy(); const a = await attempt(t.id); const co = await checkoutOf(a);
    assert.equal(await confirm(co, "RCPT0002A", 5000), null);
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where tenancy_id=$1", [t.id]))[0].n, 0);
    const [h] = await sql(db, "select reason, landlord_id, amount from held_payments where provider_ref='RCPT0002A'");
    assert.deepEqual(h, { reason: "amount_mismatch", landlord_id: w.la, amount: 5000 });
    assert.equal((await sql(db, "select status from payment_attempts where id=$1", [a]))[0].status, "failed");
    assert.equal(await balance(t.id), 6500);
  });
  it("an unknown payment request is rejected", async () => {
    await rejects(confirm("nope", "RCPT0003A", 6500), /Unknown payment request/);
  });
  it("nothing can be paid when nothing is owed", async () => {
    const t = await tenancy(); const co = await checkoutOf(await attempt(t.id));
    await confirm(co, "RCPT0004A", 6500);
    await rejects(attempt(t.id), /Nothing to pay/);
  });
  it("a failed or timed-out prompt never creates money", async () => {
    const t = await tenancy(); const a = await attempt(t.id); const co = await checkoutOf(a);
    await as(db, server, "select fail_payment_attempt($1, 1032, 'Request cancelled by user')", [co]);
    assert.equal((await sql(db, "select status from payment_attempts where id=$1", [a]))[0].status, "failed");
    assert.equal(await balance(t.id), 6500);
  });
  it("the ledger and the charges can never be edited, deleted or emptied, by anyone", async () => {
    const t = await tenancy(); await confirm(await checkoutOf(await attempt(t.id)), "RCPT0005A", 6500);
    for (const stmt of ["update ledger_entries set amount=1", "delete from ledger_entries", "truncate ledger_entries",
                        "update charges set amount=1", "delete from charges", "update audit_log set action='x'", "delete from audit_log"
                        ]) {
      await rejects(sql(db, stmt), /append-only|cannot truncate/);                      // even the database owner is stopped
      await rejects(as(db, server, stmt), /append-only|cannot truncate/);
    }
    await rejects(as(db, user(w.la), "update ledger_entries set amount=1"), /permission denied/);
    await rejects(as(db, user(w.la), "insert into ledger_entries(tenancy_id,landlord_id,kind,bucket,amount,method,provider_ref) values ($1,$2,'rent_payment','rent',1,'c2b','FAKE')", [t.id, w.la]), /permission denied/);
  });
  it("one M-Pesa receipt can never be used twice", async () => {
    const t1 = await tenancy(), t2 = await tenancy();
    await confirm(await checkoutOf(await attempt(t1.id)), "RCPT0006A", 6500);
    const a2 = await attempt(t2.id);
    const id = await confirm(await checkoutOf(a2), "RCPT0006A", 6500);       // same receipt on another tenancy: treated as the repeat it is
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where provider_ref='RCPT0006A'"))[0].n, 1);
    assert.equal(await balance(t2.id), 6500);
    assert.ok(id);
    await rejects(sql(db, "insert into ledger_entries(tenancy_id,landlord_id,kind,bucket,amount,method,provider_ref) values ($1,$2,'rent_payment','rent',6500,'c2b','RCPT0006A')", [t2.id, w.la]), /duplicate key/);
  });
  it("mistakes are fixed with a reversal: needs a reason, works once, and only the owner can do it", async () => {
    const t = await tenancy(); const id = await confirm(await checkoutOf(await attempt(t.id)), "RCPT0007A", 6500);
    assert.equal(await balance(t.id), 0);
    await rejects(as(db, user(w.la), "select reverse_payment($1,'  ')", [id]), /reason is required/);
    await rejects(as(db, user(w.lb), "select reverse_payment($1,'oops')", [id]), /Entry not found/);
    const [{ reverse_payment: rev }] = await as(db, user(w.la), "select reverse_payment($1,'Paid by mistake')", [id]);
    assert.equal(await balance(t.id), 6500);
    await rejects(as(db, user(w.la), "select reverse_payment($1,'again')", [id]), /duplicate key/);
    await rejects(as(db, user(w.la), "select reverse_payment($1,'reverse the reversal')", [rev]), /cannot be reversed/);
  });
  it("manual Paybill payments: wrong amounts and unknown accounts are refused up front", async () => {
    const t = await tenancy();
    const v = async (ref, amt) => (await as(db, server, "select validate_c2b($1,$2) r", [ref, amt]))[0].r;
    assert.equal(await v(t.tenancy_code, 6500), "ok");
    assert.equal(await v(t.tenancy_code.toLowerCase(), 6500), "ok");
    assert.equal(await v(t.tenancy_code, 3000), "amount_mismatch");
    assert.equal(await v("NOSUCH99", 6500), "unknown_account");
  });
  it("manual Paybill payments are recorded once; mismatches wait for the landlord; unknown accounts wait for the platform", async () => {
    const t = await tenancy();
    const rec = async (ref, amt, receipt) => (await as(db, server, "select record_c2b_payment($1,$2,$3,'0733000000') id", [ref, amt, receipt]))[0].id;
    const id = await rec(t.tenancy_code, 6500, "RCPT0008A");
    assert.ok(id); assert.equal(await rec(t.tenancy_code, 6500, "RCPT0008A"), id);
    assert.equal(await balance(t.id), 0);
    const t2 = await tenancy();
    assert.equal(await rec(t2.tenancy_code, 100, "RCPT0009A"), null);
    assert.equal(await rec("GHOST123", 6500, "RCPT0010A"), null);
    assert.equal((await as(db, user(w.la), "select count(*)::int n from held_payments where provider_ref='RCPT0009A'"))[0].n, 1);
    assert.equal((await as(db, user(w.la), "select count(*)::int n from held_payments where provider_ref='RCPT0010A'"))[0].n, 0);   // not theirs
    assert.equal((await as(db, user(w.admin), "select count(*)::int n from held_payments where provider_ref='RCPT0010A'"))[0].n, 1);
    assert.equal((await as(db, user(w.admin), "select count(*)::int n from held_payments where provider_ref='RCPT0009A'"))[0].n, 0);  // tenant matters stay with the landlord
  });
  it("a landlord can resolve only their own held payments, into their own tenancies", async () => {
    const t = await tenancy();
    await as(db, server, "select record_c2b_payment($1,100,'RCPT0011A','0733000000')", [t.tenancy_code]);
    const [{ id: held }] = await sql(db, "select id from held_payments where provider_ref='RCPT0011A'");
    const tb = await tenancy(w.lb, w.hB).catch(() => null);
    await rejects(as(db, user(w.lb), "select resolve_held_payment($1,$2)", [held, w.tB]), /Held payment not found/);
    const [{ id: ghost }] = await sql(db, "select id from held_payments where provider_ref='RCPT0010A'");
    await rejects(as(db, user(w.la), "select resolve_held_payment($1,$2)", [ghost, t.id]), /Held payment not found/);   // cannot grab unknown-account money
    await rejects(as(db, user(w.la), "select resolve_held_payment($1,$2)", [held, w.tB]), /Tenancy not found/);
    const [{ resolve_held_payment: lid }] = await as(db, user(w.la), "select resolve_held_payment($1,$2)", [held, t.id]);
    assert.ok(lid);
    await rejects(as(db, user(w.la), "select resolve_held_payment($1,$2)", [held, t.id]), /Held payment not found/);
    void tb;
  });
  it("payouts: each payment is paid out once, reversed payments are skipped, and direct landlords are never paid out", async () => {
    const t1 = await tenancy(), t2 = await tenancy(), t3 = await tenancy();
    const ids = [];
    for (const [t, r] of [[t1, "RCPTP001"], [t2, "RCPTP002"], [t3, "RCPTP003"]]) ids.push(await confirm(await checkoutOf(await attempt(t.id)), r, 6500));
    await as(db, user(w.la), "select reverse_payment($1,'wrong tenant')", [ids[2]]);
    await rejects(as(db, server, "select create_payout($1)", [w.la]), /No verified payout destination/);

    await as(db, user(w.la), "insert into payout_destinations(landlord_id,kind,destination) values ($1,'mpesa_phone','0712345678')", [w.la]);
    assert.equal((await sql(db, "select verified from payout_destinations where landlord_id=$1", [w.la]))[0].verified, false);
    await rejects(as(db, user(w.la), "update payout_destinations set verified=true"), /permission denied/);
    await sql(db, "update payout_destinations set verified=true where landlord_id=$1", [w.la]);                 // the server verifies it
    await as(db, user(w.la), "update payout_destinations set destination='0799999999' where landlord_id=$1", [w.la]);
    assert.equal((await sql(db, "select verified from payout_destinations where landlord_id=$1", [w.la]))[0].verified, false);   // changing it resets verification
    await sql(db, "update payout_destinations set verified=true where landlord_id=$1", [w.la]);

    const before = (await sql(db, "select coalesce(sum(amount),0)::int s from ledger_entries l where landlord_id=$1 and kind='rent_payment' and not exists (select 1 from ledger_entries r where r.reverses_id=l.id)", [w.la]))[0].s;
    const [{ create_payout: pid }] = await as(db, server, "select create_payout($1)", [w.la]);
    assert.ok(pid);
    assert.equal((await sql(db, "select amount from payouts where id=$1", [pid]))[0].amount, before);
    assert.equal((await as(db, server, "select create_payout($1) p", [w.la]))[0].p, null);                       // nothing left to pay
    await rejects(sql(db, "insert into payout_items(payout_id,ledger_entry_id) values ($1,$2)", [pid, ids[0]]), /duplicate key/);
    await rejects(sql(db, "delete from payout_items"), /append-only/);
    await rejects(sql(db, "update payout_items set payout_id=payout_id"), /append-only/);
    await sql(db, "update payment_accounts set mode='own', shortcode='123456', shortcode_kind='paybill' where landlord_id=$1", [w.la]);
    await rejects(as(db, server, "select create_payout($1)", [w.la]), /paid directly/);
    await sql(db, "update payment_accounts set mode='platform' where landlord_id=$1", [w.la]);
  });
  it("monthly charges are created once per tenancy, never for ended tenancies or suspended landlords", async () => {
    const gen = async (y, m) => (await as(db, server, "select generate_charges($1,$2) n", [y, m]))[0].n;
    const t = await tenancy();
    const first = await gen(2026, 11);
    assert.ok(first >= 1);
    assert.equal(await gen(2026, 11), 0);                                            // running it again changes nothing
    await rejects(gen(2026, 13), /Invalid month/);
    await as(db, user(w.la), "update tenancies set status='ended' where id=$1", [t.id]);
    await gen(2026, 12);
    assert.equal((await sql(db, "select count(*)::int n from charges where tenancy_id=$1 and period_month=12", [t.id]))[0].n, 0);
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.lb]);
    await gen(2027, 1);
    assert.equal((await sql(db, "select count(*)::int n from charges where tenancy_id=$1 and period_year=2027", [w.tB]))[0].n, 0);
    await sql(db, "update profiles set landlord_state='active' where id=$1", [w.lb]);
    await rejects(as(db, user(w.la), "select generate_charges(2026,11)"), /permission denied/);
    await rejects(as(db, anon, "select generate_charges(2026,11)"), /permission denied/);
  });
  it("a landlord can switch to their own Paybill only after it has been connected and verified", async () => {
    await rejects(as(db, user(w.la), "select set_payment_mode('own')"), /Connect and verify/);
    await sql(db, "update payment_accounts set status='connected', shortcode='123456', shortcode_kind='paybill' where landlord_id=$1", [w.la]);
    await as(db, user(w.la), "select set_payment_mode('own')");
    assert.equal((await as(db, user(w.la), "select mode from payment_accounts"))[0].mode, "own");
    await as(db, user(w.la), "select set_payment_mode('platform')");
  });
});
