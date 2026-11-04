import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, server, sql, rejects, buildWorld, mkUser } from "./helpers.mjs";

describe("marketer viewing marketplace", () => {
  let db, world, marketer, client, listing, fee = 400;

  before(async () => {
    db = await freshDb();
    world = await buildWorld(db);
    marketer = await mkUser(db, "marketer@market.ke", {
      meta: { requested_role: "marketer", full_name: "Mariam Marketer", phone: "0712345678" },
    });
    client = await mkUser(db, "client@market.ke", {
      meta: { requested_role: "client", full_name: "Chris Client", phone: "0723456789" },
    });
    await sql(db, "update profiles set email_verified=true, phone_verified=true where id in ($1,$2)", [marketer, client]);
  });

  const activation = async () => {
    const checkout = `activation-${crypto.randomUUID()}`;
    await as(db, server, "select start_platform_attempt($1,'marketer_activation',699,'0712345678',$2,null,null)", [marketer, checkout]);
    await as(db, server, "select confirm_platform_payment($1,$2,699,'254712345678')", [checkout, `ACT${crypto.randomUUID().slice(0, 9)}`]);
  };
  const bookAndPay = async (when = "current_date") => {
    const [created] = await as(db, user(client),
      `select create_marketplace_booking($1,${when},'Afternoon') id`, [listing]);
    const checkout = `viewing-${crypto.randomUUID()}`;
    await as(db, server,
      "select start_platform_attempt($1,'viewing_fee',$2,'0723456789',$3,null,$4)",
      [client, fee, checkout, created.id]);
    const receipt = `VIEW${crypto.randomUUID().slice(0, 8)}`;
    await as(db, server, "select confirm_platform_payment($1,$2,$3,'254723456789')", [checkout, receipt, fee]);
    return { id: created.id, receipt };
  };

  it("only self-selected marketer/client roles can be created; admin remains server-assigned", async () => {
    const requestedAdmin = await mkUser(db, "not-admin@market.ke", { meta: { requested_role: "admin" } });
    assert.equal((await sql(db, "select role from profiles where id=$1", [requestedAdmin]))[0].role, "landlord");
    assert.equal((await sql(db, "select role from profiles where id=$1", [marketer]))[0].role, "marketer");
    assert.equal((await sql(db, "select role from profiles where id=$1", [client]))[0].role, "client");
    assert.equal((await sql(db, "select status from marketplace_marketers where marketer_id=$1", [marketer]))[0].status, "pending_activation");
  });

  it("requires the confirmed KES 699 activation payment before a marketer can publish", async () => {
    const town = (await sql(db, "select id from towns where name='Bungoma Town'"))[0].id;
    await rejects(as(db, user(marketer),
      "select save_marketplace_listing(null::uuid,'House in Bungoma','A clean and spacious house for viewing.',39::smallint,$1::integer,'Bedsitter'::house_type,6500,400,true)", [town]),
    /Pay the KES 699 activation fee/);
    await rejects(as(db, server,
      "select start_platform_attempt($1,'marketer_activation',698,'0712345678','bad-activation',null,null)", [marketer]),
    /KES 699/);
    const invalidCheckout = `not-activated-${crypto.randomUUID()}`;
    await as(db, server, "select start_platform_attempt($1,'marketer_activation',699,'0712345678',$2,null,null)", [marketer, invalidCheckout]);
    await as(db, server, "select confirm_platform_payment($1,$2,699,'254712345678')", [invalidCheckout, "ACTIVATION699"]);
    assert.equal((await sql(db, "select status from marketplace_marketers where marketer_id=$1", [marketer]))[0].status, "active");
    await rejects(as(db, server,
      "select start_platform_attempt($1,'marketer_activation',699,'0712345678','duplicate-activation',null,null)", [marketer]),
    /already active/);
    await as(db, user(marketer), "select save_marketplace_listing(null::uuid,'House in Bungoma','A clean and spacious house for viewing.',39::smallint,$1::integer,'Bedsitter'::house_type,6500,400,true)", [town]);
    listing = (await sql(db, "select id from marketplace_listings where marketer_id=$1", [marketer]))[0].id;
    assert.equal((await as(db, anon, "select count(*)::int n from marketplace_public_listings where id=$1", [listing]))[0].n, 1);
    await rejects(as(db, anon, "select id from marketplace_listings"), /permission denied/);
  });

  it("booking fee is collected and client confirmation alone makes the fee payable", async () => {
    const { id, receipt } = await bookAndPay();
    assert.equal((await sql(db, "select status, payment_receipt, amount from marketplace_bookings where id=$1", [id]))[0].status, "paid");
    assert.equal((await sql(db, "select payment_receipt from marketplace_bookings where id=$1", [id]))[0].payment_receipt, receipt);
    assert.deepEqual(await as(db, user(world.tb), "select id from marketplace_bookings where id=$1", [id]), []);
    await rejects(as(db, user(world.tb), "select confirm_marketplace_viewing($1)", [id]), /not found/);
    await rejects(as(db, user(client),
      "insert into marketplace_bookings(listing_id,marketer_id,client_id,listing_title,county_name,town_name,marketer_name,client_name,booking_phone,viewing_date,time_window,amount) values ($1,$2,$3,'fake','x','y','m','fake','0723456789',current_date,'Morning',400)",
      [listing, marketer, client]), /permission denied/);
    await rejects(as(db, user(marketer), "select update_marketplace_listing($1)", [listing]), /does not exist|permission denied/);
    await as(db, user(client), "select confirm_marketplace_viewing($1)", [id]);
    assert.equal((await sql(db, "select status from marketplace_bookings where id=$1", [id]))[0].status, "viewed");

    await sql(db, "update marketplace_bookings set viewing_date=date_trunc('month',current_date)::date - 1 where id=$1", [id]);
    const [due] = await as(db, user(world.admin), "select * from admin_marketplace_settlements where id=$1", [id]);
    assert.equal(due.marketer_amount, 380);
    assert.equal(due.platform_fee, 20);
    await as(db, user(world.admin), "select admin_settle_marketplace_booking($1,'pay_marketer','MARKETER123')", [id]);
    assert.deepEqual((await sql(db, "select status, settlement_amount, platform_fee, settlement_ref from marketplace_bookings where id=$1", [id]))[0],
      { status: "paid_out", settlement_amount: 380, platform_fee: 20, settlement_ref: "MARKETER123" });
    await rejects(as(db, user(world.admin), "select admin_settle_marketplace_booking($1,'pay_marketer','MARKETER456')", [id]), /does not match/);
  });

  it("unconfirmed completed bookings are refunded in full to the booking phone", async () => {
    const { id } = await bookAndPay();
    await sql(db, "update marketplace_bookings set viewing_date=date_trunc('month',current_date)::date - 1 where id=$1", [id]);
    await rejects(as(db, user(marketer), "select admin_settle_marketplace_booking($1,'refund_client','REFUND123')", [id]), /Not allowed/);
    await as(db, user(world.admin), "select admin_settle_marketplace_booking($1,'refund_client','REFUND123')", [id]);
    assert.deepEqual((await sql(db, "select status, settlement_amount, platform_fee, settlement_ref, booking_phone from marketplace_bookings where id=$1", [id]))[0],
      { status: "refunded", settlement_amount: fee, platform_fee: 0, settlement_ref: "REFUND123", booking_phone: "0723456789" });
  });

  it("only paid client accounts with a verified phone can book and start a viewing payment", async () => {
    const unverified = await mkUser(db, "unverified-client@market.ke", {
      meta: { requested_role: "client", full_name: "No Phone Yet", phone: "0700000000" },
    });
    await sql(db, "update profiles set email_verified=true, phone_verified=false where id=$1", [unverified]);
    await rejects(as(db, user(unverified), "select create_marketplace_booking($1,current_date,'Morning')", [listing]), /Confirm your email and phone/);
    await rejects(as(db, server, "select start_platform_attempt($1,'viewing_fee',400,'0700000000','no-client',null,null)", [unverified]), /Verify your email and phone/);
    await rejects(as(db, anon, "select * from admin_marketplace_settlements"), /permission denied/);
  });
});
