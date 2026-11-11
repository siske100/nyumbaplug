import { fromDb, HttpError, type Rpc } from "./ops.ts";

export async function terminateTenantAccount(
  d: { rpc: Rpc; deleteUser(id: string): Promise<{ error: { message: string } | null }> },
  tenancyId: unknown,
) {
  if (typeof tenancyId !== "string" || !/^[0-9a-f-]{36}$/i.test(tenancyId)) {
    throw new HttpError(400, "Choose a valid tenancy");
  }
  const prepared = await d.rpc("terminate_tenant_account", { p_tenancy: tenancyId });
  if (prepared.error) throw fromDb(prepared.error);
  if (prepared.data === null) return { deleted: true };
  if (typeof prepared.data !== "string") throw new HttpError(404, "Tenant not found");

  const deleted = await d.deleteUser(prepared.data);
  if (deleted.error) {
    console.error("tenant auth account deletion failed", deleted.error.message);
    throw new HttpError(502, "The tenant moved out, but their account could not be deleted. Please try again or contact support.");
  }
  return { deleted: true };
}
