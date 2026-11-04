import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, sql, rejects, buildWorld, mkUser } from "./helpers.mjs";

describe("money", () => {
  let db, w, hBig, n = 0;
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    await sql(db, "update payment_accounts set mode='own', status='connected', shortcode='600123', shortcode_kind='paybill', credentials_ciphertext='\\x01'::bytea where landlord_id in ($1,$2)", [w.la, w.lb]);
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

  it("seeds the supplied commercial bank Paybills", async () => {
    assert.deepEqual(await sql(db, "select name, paybill from banks order by name"), [
      { name: "Absa Kenya", paybill: "303030" },
      { name: "Co-operative Bank", paybill: "400200" },
      { name: "DTB", paybill: "516600" },
      { name: "Equity Bank", paybill: "247247" },
      { name: "Family Bank", paybill: "222111" },
      { name: "I&M Bank", paybill: "542542" },
      { name: "KCB", paybill: "522522" },
      { name: "NCBA", paybill: "880100" },
      { name: "National Bank (KCB Group)", paybill: "547700" },
      { name: "Stanbic Bank", paybill: "600100" },
      { name: "Standard Chartered", paybill: "329329" },
    ]);
  });

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
    const v = async (ref, amt, landlord = w.la) => (await as(db, server, "select validate_c2b($1,$2,$3) r", [ref, amt, landlord]))[0].r;
    assert.equal(await v(t.tenancy_code, 6500), "ok");
    assert.equal(await v(t.tenancy_code.toLowerCase(), 6500), "ok");
    assert.equal(await v(t.tenancy_code, 3000), "amount_mismatch");
    assert.equal(await v("NOSUCH99", 6500), "unknown_account");
    assert.equal(await v(t.tenancy_code, 6500, null), "unknown_account");
  });
  it("manual Paybill payments are landlord-scoped; mismatches wait for that landlord; unknown accounts are rejected", async () => {
    const t = await tenancy();
    const rec = async (ref, amt, receipt, landlord = w.la) => (await as(db, server, "select record_c2b_payment($1,$2,$3,'0733000000',$4) id", [ref, amt, receipt, landlord]))[0].id;
    const id = await rec(t.tenancy_code, 6500, "RCPT0008A");
    assert.ok(id); assert.equal(await rec(t.tenancy_code, 6500, "RCPT0008A"), id);
    assert.equal(await balance(t.id), 0);
    const t2 = await tenancy();
    assert.equal(await rec(t2.tenancy_code, 100, "RCPT0009A"), null);
    assert.equal(await rec("GHOST123", 6500, "RCPT0010A"), null);
    assert.equal((await as(db, user(w.la), "select count(*)::int n from held_payments where provider_ref='RCPT0009A'"))[0].n, 1);
    assert.equal((await as(db, user(w.admin), "select count(*)::int n from held_payments where provider_ref='RCPT0010A'"))[0].n, 0);  // unknown accounts are not accepted on a landlord Paybill
  });
  it("a landlord can resolve only their own held payments, into their own tenancies", async () => {
    const t = await tenancy();
    await as(db, server, "select record_c2b_payment($1,100,'RCPT0011A','0733000000',$2)", [t.tenancy_code, w.la]);
    const [{ id: held }] = await sql(db, "select id from held_payments where provider_ref='RCPT0011A'");
    const tb = await tenancy(w.lb, w.hB).catch(() => null);
    await rejects(as(db, user(w.lb), "select resolve_held_payment($1,$2)", [held, w.tB]), /Held payment not found/);
    await rejects(as(db, user(w.la), "select resolve_held_payment($1,$2)", [held, w.tB]), /Tenancy not found/);
    const [{ resolve_held_payment: lid }] = await as(db, user(w.la), "select resolve_held_payment($1,$2)", [held, t.id]);
    assert.ok(lid);
    await rejects(as(db, user(w.la), "select resolve_held_payment($1,$2)", [held, t.id]), /Held payment not found/);
    void tb;
  });
  it("directly settled rent is never put into NyumbaPlug's payout queue", async () => {
    const t1 = await tenancy(), t2 = await tenancy();
    await confirm(await checkoutOf(await attempt(t1.id)), "RCPTP001", 6500);
    await confirm(await checkoutOf(await attempt(t2.id)), "RCPTP002", 6500);
    await rejects(as(db, server, "select create_payout($1)", [w.la]), /paid directly/);
    assert.equal((await sql(db, "select count(*)::int n from payouts where landlord_id=$1", [w.la]))[0].n, 0);
    assert.equal((await sql(db, "select count(*)::int n from payout_items i join payouts p on p.id=i.payout_id where p.landlord_id=$1", [w.la]))[0].n, 0);
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
    await sql(db, "update payment_accounts set mode='platform', status='not_connected', shortcode=null, credentials_ciphertext=null where landlord_id=$1", [w.la]);
    await rejects(as(db, user(w.la), "select set_payment_mode('own')"), /Connect and verify/);
    await sql(db, "update payment_accounts set status='connected', shortcode='123456', shortcode_kind='paybill', credentials_ciphertext='\\x01'::bytea where landlord_id=$1", [w.la]);
    await rejects(as(db, user(w.la), "select set_payment_mode('own')"), /pending M-Pesa rent prompts/);
    await sql(db, "update payment_attempts set status='failed' where landlord_id=$1 and status='pending'", [w.la]);
    await as(db, user(w.la), "select set_payment_mode('own')");
    assert.equal((await as(db, user(w.la), "select mode from payment_accounts"))[0].mode, "own");
    await rejects(as(db, user(w.la), "select set_payment_mode('platform')"), /Choose Daraja or manual bank transfer/);
  });
  it("tenant route is unavailable until the landlord has a verified own Paybill", async () => {
    const t = await tenancy();
    await sql(db, "update tenancies set tenant_user_id=$1 where id=$2", [w.ta, t.id]);
    await sql(db, "update payment_accounts set mode='platform' where landlord_id=$1", [w.la]);
    assert.equal((await as(db, user(w.ta), "select tenant_payment_route() route"))[0].route, null);
    await sql(db, "update payment_accounts set mode='own', status='connected', shortcode='123456', shortcode_kind='paybill', credentials_ciphertext='\\x01'::bytea where landlord_id=$1", [w.la]);
    assert.equal((await as(db, user(w.ta), "select tenant_payment_route() route"))[0].route, "own");
  });
  it("removed checkout routes cannot be selected and their credential columns are gone", async () => {
    await rejects(as(db, user(w.la), "select set_payment_mode('paystack')"), /invalid input value for enum/);
    assert.deepEqual(await sql(db, `select enumlabel from pg_enum
      where enumtypid='payment_mode'::regtype and enumlabel='paystack'`), []);
    assert.deepEqual(await sql(db, `select column_name from information_schema.columns
      where table_schema='public' and table_name='payment_accounts'
        and column_name in ('paystack_credentials_ciphertext','paystack_status','paystack_failure_reason')`), []);
    assert.deepEqual(await sql(db, `select column_name from information_schema.columns
      where table_schema='public' and table_name='payment_attempts' and column_name='provider'`), []);
  });
  it("refuses to credit a legacy bank-Paybill rent attempt", async () => {
    const t = await tenancy();
    const a = await attempt(t.id);
    await as(db, server, "update payment_attempts set bank_paybill_shortcode='523456' where id=$1", [a]);
    await rejects(confirm(await checkoutOf(a), "BANKRCPT001", 6500), /verified landlord-owned account/);
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where attempt_id=$1", [a]))[0].n, 0);
  });
  it("bank accounts require landlord confirmation, reset on bank changes, and stay RLS protected", async () => {
    const bank1 = (await sql(db, "insert into banks(name,paybill) values('Test Bank','523456') returning id"))[0].id;
    await sql(db, "update profiles set phone='0712345678', phone_verified=false where id=$1", [w.la]);
    await rejects(as(db, user(w.la), "update landlord_bank_accounts set verified=true"), /permission denied/);
    await rejects(as(db, user(w.la), "select start_bank_test_payment($1)", [w.la]), /permission denied/);
    await as(db, user(w.la), "select save_landlord_bank_account($1,'1234567890123456789012345678901234567890')", [bank1]);
    const [test] = await as(db, server, "select * from start_bank_test_payment($1)", [w.la]);
    assert.deepEqual(test, {
      id: test.id, paybill: "523456", account_number: "1234567890123456789012345678901234567890", phone: "0712345678",
    });
    await as(db, server, "select bind_bank_test_payment($1,'bank_CO_1')", [test.id]);
    await rejects(as(db, user(w.la), "select confirm_landlord_bank_account_test()"), /Wait for Safaricom/);
    await rejects(as(db, user(w.la), "select complete_bank_test_payment('bank_CO_1','BANKRCPT002',10,'254712345678')"), /permission denied/);
    await as(db, server, "select complete_bank_test_payment('bank_CO_1','BANKRCPT002',10,'254712345678')");
    assert.deepEqual((await as(db, user(w.la), "select status, mpesa_receipt from bank_test_payments"))[0],
      { status: "succeeded", mpesa_receipt: "BANKRCPT002" });
    assert.deepEqual(await as(db, user(w.lb), "select id from bank_test_payments"), []);
    await rejects(as(db, user(w.la), "update bank_test_payments set mpesa_receipt='LANDLORD1'"), /permission denied/);
    await as(db, user(w.la), "select confirm_landlord_bank_account_test()");
    await rejects(as(db, user(w.la), "select set_payment_mode('bank_paybill')"), /account holder name/);
    assert.equal((await as(db, user(w.la), "select mode from payment_accounts"))[0].mode, "own");

    await sql(db, "update banks set paybill='523457' where id=$1", [bank1]);
    const [reset] = await as(db, user(w.la), "select account_number, verified from landlord_bank_accounts");
    assert.deepEqual(reset, { account_number: "1234567890123456789012345678901234567890", verified: false });
    assert.equal((await as(db, user(w.la), "select mode from payment_accounts"))[0].mode, "own");
    await rejects(as(db, user(w.la), "select * from pending_stk_attempts()"), /permission denied/);
    await rejects(as(db, anon, "select * from pending_stk_attempts()"), /permission denied/);
  });
  it("bank test failures retain Safaricom diagnostics without allowing landlord writes", async () => {
    const bank = (await sql(db, "insert into banks(name,paybill) values('Diagnostic Bank','523459') returning id"))[0].id;
    await sql(db, "update profiles set phone='0712345678', phone_verified=false where id=$1", [w.la]);
    assert.equal((await as(db, user(w.la), "select save_landlord_bank_account($1,'1122334455') status", [bank]))[0].status, "reenter_account_number");
    await as(db, user(w.la), "select save_landlord_bank_account($1,'1122334455')", [bank]);
    const [test] = await as(db, server, "select * from start_bank_test_payment($1)", [w.la]);
    await as(db, server, "select bind_bank_test_payment($1,'bank_CO_FAIL')", [test.id]);
    await rejects(as(db, user(w.la), "select fail_bank_test_payment('bank_CO_FAIL',1032,'cancelled','cancel reason')"), /permission denied/);
    await as(db, server, "select fail_bank_test_payment('bank_CO_FAIL',1032,'cancelled','cancel reason')");
    assert.deepEqual((await as(db, user(w.la),
      "select status, callback_result_code, callback_result_desc, failure_reason from bank_test_payments"))[0],
    { status: "failed", callback_result_code: 1032, callback_result_desc: "cancelled", failure_reason: "cancel reason" });
  });
  it("landlords can remove their saved bank account and add replacement details", async () => {
    const bank = (await sql(db, "insert into banks(name,paybill) values('Replacement Bank','523458') returning id"))[0].id;
    await sql(db, "update profiles set phone='0712345678', phone_verified=false where id=$1", [w.la]);
    assert.equal((await as(db, user(w.la), "select save_landlord_bank_account($1,'111222333') status", [bank]))[0].status, "reenter_account_number");
    await as(db, user(w.la), "select save_landlord_bank_account($1,'111222333')", [bank]);
    const [test] = await as(db, server, "select * from start_bank_test_payment($1)", [w.la]);
    await as(db, server, "select bind_bank_test_payment($1,'bank_CO_2')", [test.id]);
    await as(db, server, "select complete_bank_test_payment('bank_CO_2','BANKRCPT003',10,'254712345678')");
    await as(db, user(w.la), "select confirm_landlord_bank_account_test()");
    await rejects(as(db, user(w.la), "select set_payment_mode('bank_paybill')"), /account holder name/);

    await rejects(as(db, user(w.lb), "select remove_landlord_bank_account()"), /No saved bank account/);
    await as(db, user(w.la), "select remove_landlord_bank_account()");
    assert.deepEqual((await as(db, user(w.la), "select bank_id, account_number, verified, test_payment_receipt from landlord_bank_accounts"))[0],
      { bank_id: bank, account_number: null, verified: false, test_payment_receipt: null });
    assert.equal((await as(db, user(w.la), "select mode from payment_accounts"))[0].mode, "own");
    assert.deepEqual((await as(db, user(w.la), "select status, mpesa_receipt from bank_test_payments"))[0],
      { status: "succeeded", mpesa_receipt: "BANKRCPT003" });

    await as(db, user(w.la), "select save_landlord_bank_account($1,'999888777')", [bank]);
    assert.deepEqual((await as(db, user(w.la), "select account_number, verified from landlord_bank_accounts"))[0],
      { account_number: "999888777", verified: false });
  });
  it("manual bank claims are landlord-reviewed and create one rent entry only after confirmation", async () => {
    await sql(db, "update payment_attempts set status='failed' where status='pending'");
    const t = await tenancy();
    const tenantId = await mkUser(db, "manual-claim@x.ke", { app: { invited_role: "tenant" } });
    await sql(db, "update tenancies set tenant_user_id=$1 where id=$2", [tenantId, t.id]);
    const bank = (await sql(db, "select id from banks where name='Replacement Bank'"))[0].id;
    await as(db, user(w.la), "select save_landlord_manual_bank_account($1,'123456789','Wanjiku A')", [bank]);
    await as(db, user(w.la), "select set_payment_mode('bank_paybill')");
    assert.equal((await as(db, user(tenantId), "select tenant_payment_route() mode"))[0].mode, "bank_paybill");
    assert.deepEqual((await as(db, user(tenantId), "select * from tenant_manual_bank_details()"))[0],
      { bank_name: "Replacement Bank", account_number: "123456789", account_name: "Wanjiku A" });
    assert.deepEqual(await as(db, user(w.tb), "select * from tenant_manual_bank_details()"), []);

    await rejects(as(db, user(tenantId), "select submit_manual_rent_payment(5000,'Bank transfer confirmation')"), /full outstanding balance/);
    await rejects(as(db, user(tenantId), "select submit_manual_rent_payment(6500,'too short')"), /Paste the bank transfer confirmation/);
    const [submitted] = await as(db, user(tenantId),
      "select submit_manual_rent_payment(6500,'Bank transfer confirmation message from the bank') id");
    assert.ok(submitted.id);
    assert.equal(await balance(t.id), 6500);
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where tenancy_id=$1", [t.id]))[0].n, 0);
    await rejects(as(db, user(tenantId),
      "select submit_manual_rent_payment(6500,'Another bank transfer confirmation message')"), /previous transfer is still waiting/);
    await rejects(as(db, user(w.la), "select set_payment_mode('own')"), /pending manual payment claims/);
    await rejects(as(db, user(w.la),
      "select save_landlord_manual_bank_account($1,'999999999','Different Holder')", [bank]), /pending manual payment claims/);
    await rejects(as(db, user(w.lb), "select review_manual_rent_payment($1,true)", [submitted.id]), /Payment claim not found/);
    await rejects(as(db, user(w.ta),
      "insert into manual_rent_payment_claims(tenancy_id,landlord_id,amount,transaction_message) values ($1,$2,6500,'Forged bank confirmation message')",
      [t.id, w.la]), /permission denied/);
    await rejects(as(db, user(w.la), "update manual_rent_payment_claims set status='received'"), /permission denied/);
    assert.equal((await as(db, user(w.lb), "select id from manual_rent_payment_claims")).length, 0);

    await as(db, user(w.la), "select review_manual_rent_payment($1,false)", [submitted.id]);
    assert.equal((await sql(db, "select status from manual_rent_payment_claims where id=$1", [submitted.id]))[0].status, "rejected");
    assert.equal(await balance(t.id), 6500);
    const [retry] = await as(db, user(tenantId),
      "select submit_manual_rent_payment(6500,'Bank transfer confirmation message from the bank') id");
    await as(db, user(w.la), "select review_manual_rent_payment($1,true)", [retry.id]);
    assert.equal((await sql(db, "select status from manual_rent_payment_claims where id=$1", [retry.id]))[0].status, "received");
    assert.equal(await balance(t.id), 0);
    assert.deepEqual((await sql(db, "select method, amount from ledger_entries where tenancy_id=$1", [t.id]))[0],
      { method: "manual_transfer", amount: 6500 });
    await rejects(as(db, user(w.la), "select review_manual_rent_payment($1,true)", [retry.id]), /already been reviewed/);
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where tenancy_id=$1", [t.id]))[0].n, 1);
    await as(db, user(w.la), "select set_payment_mode('own')");
  });
  it("manual claims cannot be confirmed after the outstanding balance changes", async () => {
    const t = await tenancy();
    const tenantId = await mkUser(db, "manual-balance@x.ke", { app: { invited_role: "tenant" } });
    await sql(db, "update tenancies set tenant_user_id=$1 where id=$2", [tenantId, t.id]);
    const bank = (await sql(db, "select id from banks where name='Replacement Bank'"))[0].id;
    await as(db, user(w.la), "select save_landlord_manual_bank_account($1,'123456789','Wanjiku A')", [bank]);
    await as(db, user(w.la), "select set_payment_mode('bank_paybill')");
    const [claim] = await as(db, user(tenantId),
      "select submit_manual_rent_payment(6500,'Bank transfer confirmation message from the bank') id");
    await sql(db, "insert into charges(tenancy_id,landlord_id,period_year,period_month,amount) values ($1,$2,2026,11,1000)", [t.id, w.la]);
    await rejects(as(db, user(w.la), "select review_manual_rent_payment($1,true)", [claim.id]), /outstanding balance changed/);
    assert.equal((await sql(db, "select status from manual_rent_payment_claims where id=$1", [claim.id]))[0].status, "pending");
    assert.equal((await sql(db, "select count(*)::int n from ledger_entries where tenancy_id=$1", [t.id]))[0].n, 0);
    await as(db, user(w.la), "select review_manual_rent_payment($1,false)", [claim.id]);
    await as(db, user(w.la), "select set_payment_mode('own')");
  });
});
