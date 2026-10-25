import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, mkUser, sql, rejects } from "./helpers.mjs";

const one = async (db, text, params) => (await sql(db, text, params))[0];

describe("phone codes", () => {
  let db, admin, l;
  const state = async (id = l) => (await one(db, "select phone_verified v, phone from profiles where id=$1", [id]));
  const issue = (hash = "hash-aaa", id = l) => as(db, server, "select issue_phone_code($1,$2) e", [id, hash]);
  const verify = async (hash, id = l) => (await as(db, server, "select verify_phone_code($1,$2) ok", [id, hash]))[0].ok;
  const rewind = (secs, id = l) => sql(db, "update verification_codes set created_at = created_at - ($2 || ' seconds')::interval, expires_at = expires_at - ($2 || ' seconds')::interval where user_id=$1", [id, String(secs)]);

  before(async () => {
    db = await freshDb();
    admin = await mkUser(db, "admin@x.ke", { app: { invited_role: "admin" } });
    l = await mkUser(db, "land@x.ke", { app: { invited_role: "tenant" }, meta: { full_name: "Wanjiku", phone: "+254 712 345 678" } });
    await as(db, server, "select mark_contact_verified($1,'email')", [l]);
  });

  it("the phone typed at sign-up is saved in a standard form; nonsense is ignored", async () => {
    assert.equal((await state()).phone, "0712345678");
    const bad = await mkUser(db, "bad@x.ke", { meta: { phone: "hello" } });
    assert.equal((await one(db, "select phone from profiles where id=$1", [bad])).phone, null);
  });
  it("a person can correct their phone until it is verified, and only to a valid number", async () => {
    await rejects(as(db, user(l), "select set_my_phone('12345')"), /valid Kenyan phone/);
    await as(db, user(l), "select set_my_phone('0711 222 333')");
    assert.equal((await state()).phone, "0711222333");
  });
  it("a code can be issued once a minute and three times an hour", async () => {
    assert.ok((await issue("h1"))[0].e);
    await rejects(issue("h2"), /Wait a minute/);
    await rewind(61); await issue("h2");
    await rewind(61); await issue("h3");
    await rewind(61);
    await rejects(issue("h4"), /Too many codes requested/);
    await rewind(3600);                                     // an hour later, the allowance is back
    await issue("h5");
  });
  it("only the newest code works: issuing a new one cancels the old", async () => {
    await rewind(3601); await issue("old-code");
    await rewind(61); await issue("new-code");
    assert.equal(await verify("old-code"), false);
  });
  it("wrong codes are counted, five wrong tries burn the code, and the right code then no longer works", async () => {
    await rewind(3601); await issue("good-code");
    for (let i = 0; i < 4; i++) assert.equal(await verify("wrong-" + i), false);
    assert.equal(await verify("wrong-4"), false);           // fifth wrong try
    await rejects(verify("good-code"), /No active code/);
  });
  it("an expired code is refused", async () => {
    await rewind(3601); await issue("expiring");
    await rewind(400);
    await rejects(verify("expiring"), /No active code/);
  });
  it("the right code verifies an invited tenant phone, once", async () => {
    const phone = (await state()).phone;
    await rewind(3601); await issue("right-code");
    assert.equal(await verify("right-code"), true);
    assert.deepEqual({ phone: (await state()).phone, verified: (await state()).v }, { phone, verified: true });
    await rejects(verify("right-code"), /No active code/);
    await rejects(issue("again"), /already verified/);
    await rejects(as(db, user(l), "select set_my_phone('0799000000')"), /already verified/);
  });
  it("a cancelled code (SMS failed to send) cannot be used", async () => {
    const x = await mkUser(db, "x@x.ke", { app: { invited_role: "tenant" }, meta: { phone: "0733000111" } });
    await as(db, server, "select issue_phone_code($1,'cc')", [x]);
    await as(db, server, "select cancel_phone_code($1)", [x]);
    await rejects(verify("cc", x), /No active code/);
  });
  it("accounts without a phone cannot request a code", async () => {
    const y = await mkUser(db, "y@x.ke", { app: { invited_role: "tenant" } });
    await rejects(as(db, server, "select issue_phone_code($1,'c')", [y]), /Add your phone number first/);
  });
  it("landlords cannot request phone codes", async () => {
    const landlord = await mkUser(db, "landlord@x.ke", { meta: { phone: "0712345678" } });
    await rejects(as(db, server, "select issue_phone_code($1,'hash')", [landlord]), /not verified with a code/);
  });
  it("browsers can neither request or check codes nor read them", async () => {
    await rejects(as(db, user(l), "select issue_phone_code($1,'x')", [l]), /permission denied/);
    await rejects(as(db, user(l), "select verify_phone_code($1,'x')", [l]), /permission denied/);
    await rejects(as(db, user(l), "select * from verification_codes"), /permission denied/);
    await rejects(as(db, anon, "select * from verification_codes"), /permission denied/);
    assert.equal((await sql(db, "select count(*)::int n from verification_codes where code_hash like 'good%'"))[0].n, 1);   // hashes only, no plain codes
  });
});

describe("private document storage", () => {
  let db, admin, a, b;
  const put = (who, path) => as(db, user(who), "insert into storage.objects(bucket_id,name,owner) values ('kyc-documents',$1,$2)", [path, who]);
  before(async () => {
    db = await freshDb();
    admin = await mkUser(db, "admin@x.ke", { app: { invited_role: "admin" } });
    a = await mkUser(db, "a@x.ke"); b = await mkUser(db, "b@x.ke");
    await sql(db, "update profiles set landlord_state='pending_kyc' where id=any(array[$1,$2]::uuid[])", [a, b]);
  });

  it("the bucket is private, limited to 5 MB, and accepts only JPEG, PNG and PDF", async () => {
    assert.deepEqual(await one(db, "select public, file_size_limit::int s, allowed_mime_types t from storage.buckets where id='kyc-documents'"),
      { public: false, s: 5242880, t: ["image/jpeg", "image/png", "application/pdf"] });
  });
  it("a landlord can upload only into their own folder", async () => {
    await put(a, `${a}/id-front.jpg`);
    await rejects(put(a, `${b}/id-front.jpg`), /row-level security/);
    await rejects(put(a, `loose-file.jpg`), /row-level security/);
  });
  it("uploads are only allowed while documents are being asked for", async () => {
    await sql(db, "update profiles set landlord_state='pending_phone' where id=$1", [b]);
    await rejects(put(b, `${b}/id-front.jpg`), /row-level security/);
    await sql(db, "update profiles set landlord_state='active' where id=$1", [b]);
    await rejects(put(b, `${b}/late.jpg`), /row-level security/);
    await sql(db, "update profiles set landlord_state='pending_kyc' where id=$1", [b]);
    await put(b, `${b}/id-front.jpg`);
  });
  it("at most twelve files per landlord", async () => {
    for (let i = 0; i < 11; i++) await put(a, `${a}/file-${i}.jpg`);
    await rejects(put(a, `${a}/one-too-many.jpg`), /row-level security/);
  });
  it("landlords read only their own files; the admin reads all; strangers read none", async () => {
    assert.equal((await as(db, user(a), "select 1 from storage.objects")).length, 12);
    assert.equal((await as(db, user(b), "select 1 from storage.objects")).length, 1);
    assert.equal((await as(db, user(admin), "select 1 from storage.objects")).length, 13);
    assert.equal((await as(db, anon, "select 1 from storage.objects")).length, 0);
  });
  it("uploaded documents can never be replaced or deleted from a browser", async () => {
    assert.equal((await as(db, user(a), "update storage.objects set name = name || 'x' returning id")).length, 0);
    assert.equal((await as(db, user(a), "delete from storage.objects returning id")).length, 0);
    assert.equal((await as(db, user(admin), "delete from storage.objects returning id")).length, 0);
    assert.equal((await sql(db, "select count(*)::int n from storage.objects"))[0].n, 13);
  });
});
