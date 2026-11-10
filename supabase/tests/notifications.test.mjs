import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, sql, rejects, buildWorld } from "./helpers.mjs";

describe("notifications: queued texts for payouts and bank-transfer claims", () => {
  let db, w, hBig, n = 0;
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    await sql(db, "update profiles set phone='0711000001', full_name='Wanjiku Kamau' where id=$1", [w.la]);
    await sql(db, "insert into payout_destinations(landlord_id,kind,destination) values ($1,'mpesa_phone','0711000001')", [w.la]);
    await sql(db, "update payout_destinations set updated_at = now() - interval '2 days'");
    hBig = (await sql(db, `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
      values ($1,'Big',39,(select id from towns where name='Bungoma Town'),'Bedsitter',6500,6500,50,50) returning id`, [w.la]))[0].id;
  });
  const outbox = (kind) => sql(db, "select * from notification_outbox where kind=$1 order by created_at", [kind]);
  const tenancy = async () => {
    n++;
    const t = (await as(db, user(w.la), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
      values ($1,$2,'N${n}','Brian Otieno','07119${String(n).padStart(5, "0")}','Emma','07229${String(n).padStart(5, "0")}','mum',6500,6500,5) returning id`, [w.la, hBig]))[0].id;
    await sql(db, "insert into charges(tenancy_id,landlord_id,period_year,period_month,amount) values ($1,$2,2026,10,6500)", [t, w.la]);
    return t;
  };

  it("nobody but the server can read or run the outbox", async () => {
    await rejects(as(db, user(w.la), "select * from notification_outbox"), /permission denied/);
    await rejects(as(db, anon, "select * from notification_outbox"), /permission denied/);
    for (const fn of ["outbox_claim(10)", "outbox_mark('" + crypto.randomUUID() + "','sent')", "notify_enqueue('payout_paid','0711000001','x',null,null,'k')"]) {
      await rejects(as(db, user(w.la), `select * from ${fn}`), /permission denied/);
      await rejects(as(db, anon, `select * from ${fn}`), /permission denied/);
    }
  });
  it("a payout request, payment and failure each queue exactly one text to the landlord, paid for by us", async () => {
    // rent collected by us, so there is something to withdraw
    const t = await tenancy(); const co = "ws_CO_N1";
    await as(db, server, "select start_payment_attempt($1,'0711000001',$2,'mr')", [t, co]);
    await as(db, server, "select confirm_payment($1,'RCPTNOTIFY1',6500,'0711000001')", [co]);
    await as(db, user(w.la), "select request_payout()");
    const [req] = await outbox("payout_requested");
    assert.equal(req.recipient_phone, "0711000001"); assert.equal(req.charge_landlord, null); assert.equal(req.status, "pending");
    assert.match(req.body, /^Hello Wanjiku, we received your payout request of KES 6500\./);
    const pid = (await as(db, user(w.admin), "select id from admin_payouts where status='scheduled'"))[0].id;
    await as(db, user(w.admin), "select admin_fail_payout($1,'Number not registered on M-Pesa')", [pid]);
    const [failed] = await outbox("payout_failed");
    assert.match(failed.body, /could not be paid: Number not registered on M-Pesa\. The money is back in your balance/);
    await as(db, user(w.la), "select request_payout()");
    const pid2 = (await as(db, user(w.admin), "select id from admin_payouts where status='scheduled'"))[0].id;
    await as(db, user(w.admin), "select admin_mark_payout_paid($1,'QWE123RTY4')", [pid2]);
    const [paid] = await outbox("payout_paid");
    assert.match(paid.body, /^Hello Wanjiku, your payout of KES 6500 has been sent to M-Pesa 0711000001\. M-Pesa ref QWE123RTY4\.$/);
    assert.equal(paid.charge_landlord, null);
    assert.equal((await outbox("payout_requested")).length, 2);                         // one per request, never repeated
  });
  it("a landlord with no usable phone number gets no text and nothing breaks", async () => {
    await sql(db, "update profiles set phone=null where id=$1", [w.la]);
    const t = await tenancy(); const co = "ws_CO_N2";
    await as(db, server, "select start_payment_attempt($1,'0711000001',$2,'mr')", [t, co]);
    await as(db, server, "select confirm_payment($1,'RCPTNOTIFY2',6500,'0711000001')", [co]);
    const before = (await outbox("payout_requested")).length;
    await as(db, user(w.la), "select request_payout()");
    assert.equal((await outbox("payout_requested")).length, before);
    await sql(db, "update profiles set phone='0711000001' where id=$1", [w.la]);
    const pid = (await as(db, user(w.admin), "select id from admin_payouts where status='scheduled'"))[0].id;
    await as(db, user(w.admin), "select admin_mark_payout_paid($1,'CLOSEOUT99')", [pid]);
  });
  it("a bank-transfer claim texts the landlord when submitted, and the tenant (from the landlord's wallet) when confirmed or rejected", async () => {
    const t = await tenancy();
    await sql(db, "update tenancies set tenant_user_id=$1 where id=$2", [w.ta, t]);
    await sql(db, "update tenancies set status='ended' where id=$1", [w.tA]);          // only this tenancy belongs to the tenant now
    const bank = (await sql(db, "insert into banks(name,paybill) values('Notify Bank','523400') returning id"))[0].id;
    await as(db, user(w.la), "select save_landlord_manual_bank_account($1,'123456789','Wanjiku K')", [bank]);
    await as(db, user(w.la), "select set_payment_mode('bank_paybill')");
    const [c] = await as(db, user(w.ta), "select submit_manual_rent_payment(6500,'Bank transfer confirmation message from the bank') id");
    const [sub] = await outbox("claim_submitted");
    assert.equal(sub.recipient_phone, "0711000001"); assert.equal(sub.charge_landlord, null);
    assert.match(sub.body, /^Hello Wanjiku, Brian says they paid KES 6500 to your bank account\./);
    await as(db, user(w.la), "select review_manual_rent_payment($1,false)", [c.id]);
    const [rej] = await outbox("claim_rejected");
    assert.deepEqual({ phone: rej.recipient_phone, charge: rej.charge_landlord }, { phone: `07119${String(n).padStart(5, "0")}`, charge: w.la });
    assert.match(rej.body, /could not confirm your payment of KES 6500/);
    const [c2] = await as(db, user(w.ta), "select submit_manual_rent_payment(6500,'A second bank transfer confirmation message') id");
    await as(db, user(w.la), "select review_manual_rent_payment($1,true)", [c2.id]);
    const [ok] = await outbox("claim_received");
    assert.equal(ok.charge_landlord, w.la); assert.match(ok.body, /^Hello Brian, your landlord confirmed your payment of KES 6500\. Thank you\.$/);
    assert.equal((await outbox("claim_submitted")).length, 2);
  });
  it("the sender takes a batch once, retries failures up to three times, and keeps paused and sent messages final", async () => {
    await sql(db, "delete from notification_outbox");
    const enq = (k) => sql(db, "select notify_enqueue('payout_paid','0711000001','Hello', null, null, $1)", [k]);
    await enq("k1"); await enq("k1"); await enq("k2"); await enq("k3");              // the same event twice is one message
    assert.equal((await sql(db, "select count(*)::int n from notification_outbox"))[0].n, 3);
    const batch = await as(db, server, "select * from outbox_claim(2)");
    assert.equal(batch.length, 2);
    assert.equal((await as(db, server, "select * from outbox_claim(10)")).length, 1);   // the rest, never the two already taken
    assert.equal((await as(db, server, "select * from outbox_claim(10)")).length, 0);
    const [a, b] = batch;
    await as(db, server, "select outbox_mark($1,'sent')", [a.id]);
    await as(db, server, "select outbox_mark($1,'paused')", [b.id]);
    assert.deepEqual((await sql(db, "select status from notification_outbox where id in ($1,$2) order by status", [a.id, b.id])).map((r) => r.status), ["paused", "sent"]);
    const [x] = await sql(db, "select id from notification_outbox where status='sending'");
    for (let i = 0; i < 2; i++) {
      await as(db, server, "select outbox_mark($1,'failed')", [x.id]);
      assert.equal((await as(db, server, "select * from outbox_claim(10)")).length, 1);
    }
    await as(db, server, "select outbox_mark($1,'failed')", [x.id]);
    assert.equal((await sql(db, "select status, attempts from notification_outbox where id=$1", [x.id]))[0].status, "failed");          // gave up after 3 tries
    await rejects(as(db, server, "select outbox_mark($1,'weird')", [x.id]), /Invalid status/);
    await sql(db, "update notification_outbox set status='sending', attempts=1, claimed_at = now() - interval '10 minutes' where id=$1", [x.id]);
    assert.equal((await as(db, server, "select * from outbox_claim(10)")).length, 1);   // a crashed run is picked up again
  });
});
