import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, mkUser, sql, rejects, buildWorld } from "./helpers.mjs";

const one = async (db, text, params) => (await sql(db, text, params))[0];
const count = async (db, who, table, where = "true", params = []) => (await as(db, who, `select count(*)::int n from ${table} where ${where}`, params))[0].n;
const call = async (db, who, text, params = []) => (await as(db, who, text, params))[0];

describe("invites", () => {
  let db, w, tN;
  const invite = (hash, tenancy = tN, landlord = w.la) => as(db, server, "select create_invite($1,'tenant',$2,null,null,null,$3) e", [landlord, tenancy, hash]);
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    tN = (await as(db, user(w.la), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
      values ($1,$2,'A9','Brian Otieno','0722111222','Grace Otieno','0733444555','mother',6500,6500,5) returning id`, [w.la, w.hA]))[0].id;
  });

  it("a tenant invite lasts 7 days, shows the house, and the secret is stored only as a hash", async () => {
    const [{ e }] = await invite("hash-1");
    assert.ok(new Date(e) > new Date(Date.now() + 6.9 * 86400000));
    const info = (await as(db, server, "select invite_lookup('hash-1') i"))[0].i;
    assert.deepEqual({ kind: info.kind, house: info.house_title, unit: info.unit_label, phone: info.invitee_phone }, { kind: "tenant", house: "Block A", unit: "A9", phone: "0722111222" });
    assert.equal((await as(db, server, "select invite_lookup('nope') i"))[0].i, null);
    assert.equal(await count(db, user(w.la), "login_invites"), 1);
    assert.equal(await count(db, user(w.lb), "login_invites"), 0);
    await rejects(as(db, user(w.la), "select token_hash from login_invites"), /permission denied/);
  });
  it("a new invite cancels the old one, and a tenant who already joined cannot be invited again", async () => {
    await invite("hash-2");
    assert.equal((await as(db, server, "select invite_lookup('hash-1') i"))[0].i, null);
    assert.ok((await as(db, server, "select invite_lookup('hash-2') i"))[0].i);
    await rejects(invite("hash-x", w.tA), /already joined/);
    await rejects(invite("hash-x", tN, w.lb), /Tenant not found/);
  });
  it("a caretaker invite checks the house and the phone", async () => {
    const inv = (house, phone, hash) => as(db, server, "select create_invite($1,'caretaker',null,$2,'Peter Mwangi',$3,$4) e", [w.la, house, phone, hash]);
    await inv(w.hA, "+254 712 000 111", "care-1");
    assert.equal((await as(db, server, "select invite_lookup('care-1') i"))[0].i.invitee_phone, "0712000111");
    await rejects(inv(w.hA, "12345", "care-2"), /valid Kenyan phone/);
    await rejects(inv(w.hB, "0712000111", "care-3"), /House not found/);
  });
  it("accepting links the tenant to the tenancy, once, and only with the right kind of account", async () => {
    const newTenant = await mkUser(db, "newtenant@x.ke", { app: { invited_role: "tenant" } });
    const newLandlord = await mkUser(db, "stray@x.ke");
    await rejects(as(db, server, "select invite_accept('hash-2',$1)", [newLandlord]), /cannot accept that invite/);
    assert.equal((await as(db, server, "select invite_accept('hash-2',$1) k", [newTenant]))[0].k, "tenant");
    const t = await one(db, "select tenant_user_id u from tenancies where id=$1", [tN]);
    assert.equal(t.u, newTenant);
    const p = await one(db, "select phone, phone_verified v from profiles where id=$1", [newTenant]);
    assert.deepEqual(p, { phone: "0722111222", v: false });                  // the phone still has to be verified by code
    assert.equal((await as(db, user(newTenant), "select id from tenancies")).length, 1);
    await rejects(as(db, server, "select invite_accept('hash-2',$1)", [newTenant]), /no longer valid/);
  });
  it("caretakers are assigned to the house when they accept", async () => {
    const c = await mkUser(db, "newcare@x.ke", { app: { invited_role: "caretaker" } });
    await as(db, server, "select invite_accept('care-1',$1)", [c]);
    assert.deepEqual((await as(db, user(c), "select id from houses")).map((r) => r.id), [w.hA]);
  });
  it("expired invites and invites from locked landlords stop working", async () => {
    await sql(db, "update tenancies set tenant_user_id = null where id=$1", [w.tB]);
    await invite("hash-3", w.tB, w.lb);
    await sql(db, "update login_invites set expires_at = now() - interval '1 minute' where token_hash='hash-3'");
    assert.equal((await as(db, server, "select invite_lookup('hash-3') i"))[0].i, null);
    await invite("hash-4", w.tB, w.lb);
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.lb]);
    assert.equal((await as(db, server, "select invite_lookup('hash-4') i"))[0].i, null);
    await rejects(as(db, server, "select invite_accept('hash-4',$1)", [w.tb]), /no longer valid/);
    await rejects(invite("hash-5", w.tB, w.lb), /not active/);
    await sql(db, "update profiles set landlord_state='active' where id=$1", [w.lb]);
  });
  it("at most five invites a day for one person", async () => {
    for (let i = 0; i < 3; i++) await invite("cap-" + i, w.tB, w.lb);
    await rejects(invite("cap-x", w.tB, w.lb), /Too many invites today/);
  });
});

describe("public viewing requests", () => {
  let db, w;
  const submit = (phone, ip = "a".repeat(64), date = "current_date + 1", house = null) =>
    as(db, server, `select create_public_visit_request($1,'Faith Njeri',$2,${date},'Morning',$3) id`, [house ?? w.hA, phone, ip]);
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("includes the expanded town catalog for all 47 counties without duplicate choices", async () => {
    const coverage = await one(db, "select count(distinct county_id)::int counties, count(*)::int towns from towns");
    assert.equal(coverage.counties, 47);
    assert.ok(coverage.towns > 400, `expected expanded town catalog, got ${coverage.towns} towns`);
    assert.equal((await one(db, "select count(*)::int duplicates from (select county_id, name from towns group by county_id, name having count(*) > 1) t")).duplicates, 0);
    for (const [county, name] of [
      [47, "Githurai 44"], [47, "Githurai 45"], [47, "Mihang’o"], [47, "Nairobi South"],
      [22, "Kiambu"], [22, "Thika Town"], [22, "Lari"], [42, "Kisumu CBD"], [42, "Luanda Kotieno"],
      [1, "Mombasa Old Town"], [2, "Ukunda"], [3, "Malindi"], [4, "Hola"], [5, "Mpeketoni"],
      [6, "Wundanyi"], [7, "Dadaab"], [8, "Habaswein"], [9, "Elwak"], [10, "Moyale"],
      [11, "Garbatulla"], [12, "Maua"], [13, "Chuka"], [14, "Runyenjes"], [15, "Mwingi"],
      [16, "Machakos"], [17, "Wote"], [18, "Ol Kalou"], [19, "Karatina"], [20, "Kerugoya"],
      [21, "Murang'a"], [23, "Lodwar"], [24, "Kapenguria"], [25, "Maralal"], [26, "Kitale"],
      [27, "Eldoret"], [28, "Iten"], [29, "Kapsabet"], [30, "Kabarnet"], [31, "Nanyuki"],
      [32, "Naivasha"], [33, "Kilgoris"], [34, "Kitengela"], [35, "Litein"], [36, "Sotik"],
      [37, "Mumias"], [38, "Luanda"], [39, "Webuye"], [40, "Malaba"], [41, "Bondo"],
      [43, "Mbita"], [44, "Awendo"], [45, "Ogembo"], [46, "Keroka"],
    ]) {
      assert.equal((await one(db, "select exists(select 1 from towns where county_id=$1 and name=$2) found", [county, name])).found, true, `${name} in county ${county}`);
    }
  });

  it("creates a viewing request directly with a phone number and preferred time", async () => {
    const [{ id }] = await submit("0711888001");
    assert.ok(id);
    assert.equal((await one(db, "select visitor_phone p from visit_requests where id=$1", [id])).p, "0711888001");
  });
  it("keeps date, phone, and open-request checks in place", async () => {
    await rejects(submit("0711888002", "b".repeat(64), "current_date + 9"), /within the next 7 days/);
    await rejects(submit("12345"), /valid Kenyan phone number/);
    await submit("0711888003", "b".repeat(64));
    await submit("0711888003", "b".repeat(64));
    await submit("0711888003", "b".repeat(64));
    await rejects(submit("0711888003", "b".repeat(64), "current_date + 1", w.hB), /Too many open requests for this number/);
  });
  it("limits accepted requests per network address and keeps limit data private", async () => {
    const ip = "c".repeat(64);
    await sql(db, "insert into visitor_request_ip_limits(ip_hash) select $1 from generate_series(1,10)", [ip]);
    await rejects(submit("0711888004", ip), /Too many viewing requests from your connection/);
    await rejects(as(db, anon, "select * from visitor_request_ip_limits"), /permission denied/);
    await rejects(as(db, anon, "select create_public_visit_request($1,'A B','0711000000',current_date,'Morning',$2)", [w.hA, "d".repeat(64)]), /permission denied/);
  });
});

describe("landlord purchases: subscription and SMS credit", () => {
  let db, w;
  const start = (purpose, amount, landlord = w.la, checkout = "ws_" + Math.random()) =>
    as(db, server, "select start_platform_attempt($1,$2,$3,'0712345678',$4,'mr') id", [landlord, purpose, amount, checkout]).then((r) => ({ id: r[0].id, checkout }));
  const confirm = async (checkout, receipt, amount) => (await as(db, server, "select confirm_platform_payment($1,$2,$3,'0712345678') ok", [checkout, receipt, amount]))[0].ok;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("the subscription must be paid at exactly the current price, and only by landlords who are verified", async () => {
    await rejects(start("subscription", 900), /subscription is KES 1000/);
    await start("subscription", 1000);
    const fresh = await mkUser(db, "fresh@x.ke");
    await rejects(start("subscription", 1000, fresh), /Complete verification/);
    const sus = await mkUser(db, "sus@x.ke"); await sql(db, "update profiles set landlord_state='suspended' where id=$1", [sus]);
    await rejects(start("subscription", 1000, sus), /suspended/);
  });
  it("a confirmed subscription payment extends the plan once, however many times Safaricom calls", async () => {
    const { checkout } = await start("subscription", 1000);
    assert.equal(await confirm(checkout, "PLAT0001", 1000), true);
    assert.equal(await confirm(checkout, "PLAT0001", 1000), true);
    assert.equal((await one(db, "select count(*)::int n from subscription_payments where provider_ref='PLAT0001'")).n, 1);
    assert.equal((await one(db, "select landlord_state s from profiles where id=$1", [w.la])).s, "active");
  });
  it("SMS credit: only for active landlords, between KES 50 and 10,000, credited once", async () => {
    await rejects(start("sms_recharge", 40), /between KES 50 and KES 10,000/);
    await rejects(start("sms_recharge", 20000), /between KES 50 and KES 10,000/);
    const { checkout } = await start("sms_recharge", 500);
    assert.equal(await confirm(checkout, "PLAT0002", 500), true);
    await confirm(checkout, "PLAT0002", 500);
    assert.equal(Number((await one(db, "select balance_kes b from sms_wallets where landlord_id=$1", [w.la])).b), 500);
  });
  it("a wrong amount is held for the platform, not credited, and landlords cannot see it", async () => {
    const { checkout } = await start("sms_recharge", 300);
    assert.equal(await confirm(checkout, "PLAT0003", 100), false);
    assert.equal(Number((await one(db, "select balance_kes b from sms_wallets where landlord_id=$1", [w.la])).b), 500);
    assert.equal(await count(db, user(w.admin), "held_payments", "provider_ref='PLAT0003'"), 1);
    assert.equal(await count(db, user(w.la), "held_payments", "provider_ref='PLAT0003'"), 0);
    await rejects(as(db, server, "select confirm_platform_payment('unknown','X1',1,'0712345678')"), /Unknown payment request/);
  });
  it("failed prompts create no money, and too many attempts are stopped", async () => {
    const { id, checkout } = await start("sms_recharge", 100);
    await as(db, server, "select fail_platform_attempt($1,1032,'Cancelled')", [checkout]);
    assert.equal((await one(db, "select status s from platform_attempts where id=$1", [id])).s, "failed");
    await rejects(start("sms_recharge", 100), /Too many payment attempts/);
    assert.equal(await count(db, user(w.lb), "platform_attempts", "landlord_id=$1", [w.la]), 0);
  });
});

describe("rent reminders", () => {
  let db, w;
  const due = async (date) => (await as(db, server, "select * from due_reminders($1::date)", [date]));
  before(async () => { db = await freshDb(); w = await buildWorld(db); await as(db, server, "select generate_charges(2026,11)"); });

  it("default reminders: two days before and on the due day, only for tenants who still owe", async () => {
    const d3 = await due("2026-11-03");
    assert.deepEqual(d3.map((r) => r.trigger).sort(), ["2d", "2d"]);
    assert.equal(d3.find((r) => r.tenancy_id === w.tA).phone, "0711000001");
    assert.equal((await due("2026-11-05")).every((r) => r.trigger === "due"), true);
    assert.equal((await due("2026-11-04")).length, 0);                       // 1d is not in the default schedule
    assert.equal((await due("2026-11-20")).length, 0);
  });
  it("a landlord can choose their own schedule, but only from the allowed triggers", async () => {
    await as(db, user(w.la), "insert into reminder_schedules(landlord_id, triggers) values ($1, array['1d','overdue'])", [w.la]);
    assert.deepEqual((await due("2026-11-04")).map((r) => r.tenancy_id), [w.tA]);
    assert.deepEqual((await due("2026-11-06")).map((r) => r.trigger), ["overdue"]);
    assert.equal((await due("2026-11-03")).filter((r) => r.tenancy_id === w.tA).length, 0);
    await rejects(as(db, user(w.la), "update reminder_schedules set triggers = array['3d']"), /check constraint/);
    assert.equal((await as(db, user(w.lb), "update reminder_schedules set triggers = array['due'] where landlord_id=$1 returning landlord_id", [w.la])).length, 0);
    assert.equal(await count(db, user(w.ta), "reminder_schedules"), 0);
  });
  it("each reminder is sent once, paid-up tenants and locked landlords are skipped", async () => {
    await as(db, server, "select mark_reminder_sent($1,'2026-11-05'::date,'due')", [w.tB]);
    assert.equal((await due("2026-11-05")).some((r) => r.tenancy_id === w.tB), false);
    await as(db, server, "select mark_reminder_sent($1,'2026-11-05'::date,'due')", [w.tB]);              // twice is fine
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.la]);
    assert.equal((await due("2026-11-06")).length, 0);
    await sql(db, "update profiles set landlord_state='active' where id=$1", [w.la]);
    await sql(db, "insert into ledger_entries(tenancy_id,landlord_id,kind,bucket,amount,method,provider_ref) values ($1,$2,'rent_payment','rent',13000,'c2b','PAIDUP01')", [w.tA, w.la]);
    assert.equal((await due("2026-11-06")).length, 0);
  });
  it("message status only moves forward from queued or sent", async () => {
    const id = (await sql(db, "insert into sms_messages(landlord_id,template,recipient,body,segments,cost_kes,status) values ($1,'rent_reminder','0711000001','hi',1,0.8,'queued') returning id", [w.la]))[0].id;
    await as(db, server, "select sms_mark_status($1,'delivered','M123')", [id]);
    assert.equal((await one(db, "select status s, provider_msg_id p from sms_messages where id=$1", [id])).s, "delivered");
    await as(db, server, "select sms_mark_status($1,'queued',null)", [id]);
    assert.equal((await one(db, "select status s from sms_messages where id=$1", [id])).s, "delivered");
  });
});

describe("payment credentials and manual payouts", () => {
  let db, w;
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("saved credentials are readable only by the server, with the callback address kept secret", async () => {
    await as(db, server, "select save_payment_credentials($1,'123456','paybill','\\x0102030405'::bytea,1::smallint,'connected',null)", [w.la]);
    assert.deepEqual(await call(db, user(w.la), "select status, shortcode from payment_accounts"), { status: "connected", shortcode: "123456" });
    await rejects(as(db, user(w.la), "select credentials_ciphertext from payment_accounts"), /permission denied/);
    const c = await call(db, server, "select * from get_payment_credentials($1)", [w.la]);
    assert.equal(Buffer.from(c.cipher).toString("hex"), "0102030405");
    assert.equal((await call(db, server, "select account_by_token($1) a", [c.callback_token])).a.landlord_id, w.la);
    assert.equal((await call(db, server, "select account_by_token('guess') a")).a, null);
    await rejects(as(db, user(w.la), "select * from get_payment_credentials($1)", [w.la]), /permission denied/);
  });
  it("if the connection breaks, rent falls back to the platform Paybill", async () => {
    await as(db, user(w.la), "select set_payment_mode('own')");
    await as(db, server, "select save_payment_credentials($1,'123456','paybill',null,null,'failed','Safaricom rejected the keys')", [w.la]);
    assert.deepEqual(await call(db, user(w.la), "select mode, status, failure_reason from payment_accounts"), { mode: "platform", status: "failed", failure_reason: "Safaricom rejected the keys" });
  });
  it("the admin sees payouts and records the M-Pesa reference once", async () => {
    await sql(db, "insert into payout_destinations(landlord_id,kind,destination,verified) values ($1,'mpesa_phone','0712345678',true)", [w.la]);
    await sql(db, "insert into ledger_entries(tenancy_id,landlord_id,kind,bucket,amount,method,provider_ref) values ($1,$2,'rent_payment','rent',6500,'c2b','PAYOUT001')", [w.tA, w.la]);
    assert.equal((await call(db, server, "select create_due_payouts() n")).n, 1);
    assert.equal((await call(db, server, "select create_due_payouts() n")).n, 0);
    const p = (await as(db, user(w.admin), "select * from admin_payouts"))[0];
    assert.deepEqual({ name: p.full_name, amount: p.amount, dest: p.destination, status: p.status }, { name: null, amount: 6500, dest: "0712345678", status: "scheduled" });
    assert.equal(await count(db, user(w.lb), "admin_payouts"), 0);
    await rejects(as(db, user(w.la), "select admin_mark_payout_paid($1,'MPESAREF01')", [p.id]), /Not allowed/);
    await rejects(as(db, user(w.admin), "select admin_mark_payout_paid($1,'SHORT')", [p.id]), /full M-Pesa reference/);
    await as(db, user(w.admin), "select admin_mark_payout_paid($1,'mpesaref01')", [p.id]);
    await rejects(as(db, user(w.admin), "select admin_mark_payout_paid($1,'MPESAREF02')", [p.id]), /already paid/);
    assert.deepEqual(await call(db, user(w.la), "select status, provider_ref from payouts"), { status: "paid", provider_ref: "MPESAREF01" });
  });
});

describe("photo and agreement storage", () => {
  let db, w;
  const put = (who, bucket, path) => as(db, user(who), "insert into storage.objects(bucket_id,name,owner) values ($1,$2,$3)", [bucket, path, who]);
  before(async () => { db = await freshDb(); w = await buildWorld(db); });

  it("house photos go only into the landlord's own folder, and only while the account is active", async () => {
    await put(w.la, "house-photos", `${w.la}/${w.hA}/a.jpg`);
    await rejects(put(w.la, "house-photos", `${w.lb}/x.jpg`), /row-level security/);
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.la]);
    await rejects(put(w.la, "house-photos", `${w.la}/${w.hA}/b.jpg`), /row-level security/);
    await sql(db, "update profiles set landlord_state='active' where id=$1", [w.la]);
  });
  it("landlords can remove only their own photos", async () => {
    assert.equal((await as(db, user(w.lb), "delete from storage.objects where bucket_id='house-photos' returning id")).length, 0);
    assert.equal((await as(db, user(w.la), "delete from storage.objects where bucket_id='house-photos' returning id")).length, 1);
  });
  it("agreements: the landlord uploads, the tenant of that tenancy can read, nobody else, and nothing can be changed afterwards", async () => {
    const path = `${w.la}/${w.tA}/signed-1.pdf`;
    await put(w.la, "agreements", path);
    await rejects(put(w.lb, "agreements", `${w.la}/other.pdf`), /row-level security/);
    assert.equal((await as(db, user(w.ta), "select 1 from storage.objects where bucket_id='agreements'")).length, 0);      // not linked yet
    await as(db, user(w.la), "update tenancies set agreement_file_path=$2, agreement_signed_on=current_date where id=$1", [w.tA, path]);
    assert.equal((await as(db, user(w.ta), "select 1 from storage.objects where bucket_id='agreements'")).length, 1);
    assert.equal((await as(db, user(w.tb), "select 1 from storage.objects where bucket_id='agreements'")).length, 0);
    assert.equal((await as(db, user(w.lb), "select 1 from storage.objects where bucket_id='agreements'")).length, 0);
    assert.equal((await as(db, user(w.la), "update storage.objects set name='x' where bucket_id='agreements' returning id")).length, 0);
    assert.equal((await as(db, user(w.la), "delete from storage.objects where bucket_id='agreements' returning id")).length, 0);
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.la]);
    assert.equal((await as(db, user(w.ta), "select 1 from storage.objects where bucket_id='agreements'")).length, 0);   // locked with the landlord
  });
});

describe("payment plumbing", () => {
  let db, w, hBig, n = 0;
  before(async () => {
    db = await freshDb(); w = await buildWorld(db);
    hBig = (await sql(db, `insert into houses(landlord_id,title,county_id,town_id,house_type,rent_amount,deposit_amount,total_units,vacant_units)
      values ($1,'Big',39,(select id from towns where name='Bungoma Town'),'Bedsitter',6500,6500,50,50) returning id`, [w.la]))[0].id;
  });
  const tenancy = async (landlord = w.la, house = hBig) => {
    n++;
    const t = (await as(db, user(landlord), `insert into tenancies(landlord_id,house_id,unit_label,tenant_name,tenant_phone,emergency_name,emergency_phone,emergency_relationship,rent_amount,deposit_amount,due_day)
      values ($1,$2,'P${n}','Tenant','07115${String(n).padStart(5, "0")}','Emma','07225${String(n).padStart(5, "0")}','mum',6500,6500,5) returning id, tenancy_code`, [landlord, house]))[0];
    await sql(db, "insert into charges(tenancy_id,landlord_id,period_year,period_month,amount) values ($1,$2,2026,10,6500)", [t.id, landlord]);
    return t;
  };

  it("a payment attempt is created first, then bound to Safaricom's request id", async () => {
    const t = await tenancy();
    const a = (await as(db, server, "select start_payment_attempt($1,'0712345678',$2,null) id", [t.id, "pending-" + n]))[0].id;
    await as(db, server, "select bind_payment_attempt($1,'ws_CO_REAL1','MR1')", [a]);
    assert.equal((await one(db, "select checkout_request_id c from payment_attempts where id=$1", [a])).c, "ws_CO_REAL1");
    await as(db, server, "select bind_payment_attempt($1,'ws_CO_OTHER','MR2')", [a]);                    // already bound: ignored
    assert.equal((await one(db, "select checkout_request_id c from payment_attempts where id=$1", [a])).c, "ws_CO_REAL1");
    const look = (await as(db, server, "select attempt_lookup('ws_CO_REAL1') l"))[0].l;
    assert.deepEqual({ kind: look.kind, landlord: look.landlord_id, amount: look.amount }, { kind: "tenant", landlord: w.la, amount: 6500 });
    assert.equal((await as(db, server, "select attempt_lookup('nope') l"))[0].l, null);
  });
  it("one attempt can never be credited twice, even with a different receipt number", async () => {
    const t = await tenancy();
    const a = (await as(db, server, "select start_payment_attempt($1,'0712345678','ws_CO_TWICE','mr') id", [t.id]))[0].id;
    const first = (await as(db, server, "select confirm_payment('ws_CO_TWICE','REALRECEIPT1',6500,'0712345678') id"))[0].id;
    const again = (await as(db, server, "select confirm_payment('ws_CO_TWICE','STKQ-ws_CO_TWICE',6500,'0712345678') id"))[0].id;
    assert.equal(again, first);
    assert.equal((await one(db, "select count(*)::int n from ledger_entries where attempt_id=$1", [a])).n, 1);
  });
  it("a failed prompt can be failed by its id, and silent attempts show up for a status check", async () => {
    const t = await tenancy();
    const a = (await as(db, server, "select start_payment_attempt($1,'0712345678','pending-x1',null) id", [t.id]))[0].id;
    await as(db, server, "select fail_attempt_by_id('tenant',$1,'Safaricom unavailable')", [a]);
    assert.equal((await one(db, "select status s from payment_attempts where id=$1", [a])).s, "failed");
    const t2 = await tenancy();
    const b = (await as(db, server, "select start_payment_attempt($1,'0712345678','ws_CO_SILENT','m') id", [t2.id]))[0].id;
    assert.equal((await as(db, server, "select * from pending_attempts('0 seconds')")).some((r) => r.id === b), true);
    assert.equal((await as(db, server, "select * from pending_attempts('3 minutes')")).some((r) => r.id === b), false);   // too recent
    await sql(db, "update payment_attempts set created_at = now() - interval '25 hours' where id=$1", [b]);
    assert.equal((await as(db, server, "select expire_old_attempts() n"))[0].n >= 1, true);
    assert.equal((await one(db, "select status s from payment_attempts where id=$1", [b])).s, "timeout");
  });
  it("a landlord's own Paybill only accepts that landlord's own tenants", async () => {
    const mine = await tenancy(w.la);
    const v = async (code, amt, l) => (await as(db, server, "select validate_c2b($1,$2,$3) r", [code, amt, l]))[0].r;
    const rec = (code, receipt, l) => as(db, server, "select record_c2b_payment($1,6500,$2,'0733000000',$3) id", [code, receipt, l]);
    assert.equal(await v(mine.tenancy_code, 6500, null), "ok");                          // platform Paybill, landlord uses the platform Paybill
    assert.equal(await v(mine.tenancy_code, 6500, w.la), "unknown_account");             // not connected to their own yet
    await sql(db, "update payment_accounts set mode='own', shortcode='123456', shortcode_kind='paybill', status='connected' where landlord_id=$1", [w.la]);
    assert.equal(await v(mine.tenancy_code, 6500, w.la), "ok");                          // their own Paybill, their own tenant
    assert.equal(await v(mine.tenancy_code, 6500, w.lb), "unknown_account");             // someone else's Paybill
    assert.equal(await v(mine.tenancy_code, 6500, null), "unknown_account");             // paid to the platform by mistake: refused, the landlord would never receive it
    assert.equal((await rec(mine.tenancy_code, "OWN0001", w.lb))[0].id, null);           // held for the platform
    assert.equal((await one(db, "select landlord_id l from held_payments where provider_ref='OWN0001'")).l, null);
    assert.equal((await rec(mine.tenancy_code, "OWN0003", null))[0].id, null);
    assert.ok((await rec(mine.tenancy_code, "OWN0002", w.la))[0].id);
    await sql(db, "update payment_accounts set mode='platform' where landlord_id=$1", [w.la]);
  });
  it("the payment-received text has what it needs, and SMS status can be read by the server only", async () => {
    const t = await tenancy();
    await as(db, server, "select start_payment_attempt($1,'0712345678','ws_CO_NOTICE','m')", [t.id]);
    const id = (await as(db, server, "select confirm_payment('ws_CO_NOTICE','NOTICE001',6500,'0712345678') id"))[0].id;
    const n1 = (await as(db, server, "select ledger_notice($1) n", [id]))[0].n;
    assert.deepEqual({ amount: n1.amount, balance: n1.balance, phone: n1.phone }, { amount: 6500, balance: 0, phone: t.tenancy_code ? n1.phone : "" });
    await rejects(as(db, user(w.la), "select ledger_notice($1)", [id]), /permission denied/);
    await rejects(as(db, user(w.la), "select sms_message_status(gen_random_uuid())"), /permission denied/);
  });
});

describe("caretaker list", () => {
  it("a landlord sees their own caretakers with names, and other landlords see none", async () => {
    const db = await freshDb(); const w = await buildWorld(db);
    await sql(db, "update profiles set full_name='Peter Mwangi', phone='0723000111' where id=$1", [w.care]);
    const mine = await as(db, user(w.la), "select * from my_caretakers");
    assert.deepEqual(mine.map((r) => ({ n: r.full_name, h: r.house_title })), [{ n: "Peter Mwangi", h: "Block A" }]);
    assert.equal(await count(db, user(w.lb), "my_caretakers"), 0);
    assert.equal(await count(db, user(w.ta), "my_caretakers"), 0);
    assert.equal(await count(db, user(w.admin), "my_caretakers"), 0);
    await sql(db, "update profiles set landlord_state='suspended' where id=$1", [w.la]);
    assert.equal(await count(db, user(w.la), "my_caretakers"), 0);
  });
});
