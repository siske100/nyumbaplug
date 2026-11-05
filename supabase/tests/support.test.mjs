import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { freshDb, as, user, anon, sql, rejects, buildWorld } from "./helpers.mjs";

describe("platform support requests", () => {
  let db, world;
  before(async () => { db = await freshDb(); world = await buildWorld(db); });

  it("users can submit a plain issue and see only their own requests", async () => {
    await rejects(as(db, user(world.ta), "select submit_support_request('too short')"), /10 to 5000 characters/);
    await as(db, user(world.ta), "select submit_support_request('The payment page is not loading for me')");
    const mine = await as(db, user(world.ta), "select message, status from support_requests");
    assert.deepEqual(mine, [{ message: "The payment page is not loading for me", status: "open" }]);
    assert.deepEqual(await as(db, user(world.tb), "select id from support_requests"), []);
    await rejects(as(db, anon, "select id from support_requests"), /permission denied/);
    await rejects(as(db, user(world.ta),
      "insert into support_requests(user_id, message) values ($1, 'A user cannot insert support requests directly')", [world.ta]), /permission denied/);
  });

  it("only admins can review submitted issues and change their status", async () => {
    await as(db, user(world.ta), "select submit_support_request('I cannot upload a property photo')");
    const rows = await as(db, user(world.admin), "select id, full_name, role, message, status from admin_support_requests()");
    const request = rows.find((row) => row.message === "I cannot upload a property photo");
    assert.deepEqual(request, {
      id: request.id, full_name: "Account", role: "tenant",
      message: "I cannot upload a property photo", status: "open",
    });
    await rejects(as(db, user(world.la), "select * from admin_support_requests()"), /Not allowed/);
    await rejects(as(db, user(world.la), "select admin_update_support_request($1,'resolved')", [request.id]), /Not allowed/);
    await as(db, user(world.admin), "select admin_update_support_request($1,'resolved')", [request.id]);
    assert.deepEqual(await as(db, user(world.ta), "select status from support_requests where id=$1", [request.id]), [{ status: "resolved" }]);
    await rejects(as(db, user(world.admin), "select admin_update_support_request($1,'invalid')", [request.id]), /Invalid support request status/);
  });
});
