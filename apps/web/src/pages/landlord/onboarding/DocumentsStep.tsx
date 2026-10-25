import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { validateKycFile } from "@rh/shared";
import { api } from "@/api";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { FileField } from "@/components/ui/FileField";
import { ApiError } from "@/lib/queryClient";
import { qk } from "@/lib/queryKeys";
import { kraPinSchema, nationalIdSchema } from "@/lib/validation";

type Slot = "idFront" | "idBack" | "kra";
const LABELS: Record<Slot, string> = { idFront: "National ID, front", idBack: "National ID, back", kra: "KRA PIN certificate" };

export function DocumentsStep() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["kyc-status"], queryFn: () => api.kycStatus() });
  const [nationalId, setNationalId] = useState("");
  const [kraPin, setKraPin] = useState("");
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [errors, setErrors] = useState<Partial<Record<Slot | "nationalId" | "kraPin", string>>>({});

  const submit = useMutation({
    mutationFn: () => api.submitKyc({ nationalId, kraPin: kraPinSchema.parse(kraPin), idFront: files.idFront!, idBack: files.idBack!, kra: files.kra! }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: qk.session }); await qc.invalidateQueries({ queryKey: ["kyc-status"] }); },
  });

  const pick = async (slot: Slot, file: File | null) => {
    if (!file) { setFiles((f) => ({ ...f, [slot]: undefined })); return; }
    const check = validateKycFile(file, new Uint8Array(await file.slice(0, 8).arrayBuffer()));
    setErrors((e) => ({ ...e, [slot]: check.ok ? undefined : check.reason }));
    setFiles((f) => ({ ...f, [slot]: check.ok ? file : undefined }));
  };

  const onSubmit = () => {
    const e: typeof errors = {};
    if (!nationalIdSchema.safeParse(nationalId).success) e.nationalId = "National ID is 7 or 8 digits";
    const pin = kraPinSchema.safeParse(kraPin);
    if (!pin.success) e.kraPin = pin.error.issues[0]?.message;
    for (const slot of Object.keys(LABELS) as Slot[]) if (!files[slot]) e[slot] = e[slot] ?? "Choose this file";
    setErrors(e);
    if (Object.keys(e).length === 0) submit.mutate();
  };

  if (status.data && status.data.attemptsUsed >= status.data.maxAttempts) {
    return (
      <div className="grid gap-2">
        <h2 className="text-2xl">Please contact customer care</h2>
        <p className="text-graphite-300">You have used all {status.data.maxAttempts} attempts. Call 0799326074 and we will help you finish.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl">Upload your documents</h2>
        <p className="mt-1 text-graphite-300">We use these to verify you before you can list houses. Only our review team can open them.</p>
      </div>
      {status.data?.lastRejection && (
        <div role="alert" className="rounded-xl border border-danger/35 bg-danger/8 p-4">
          <p className="font-medium">Your last documents were not accepted</p>
          <p className="mt-1 text-sm text-graphite-200">{status.data.lastRejection}</p>
          <p className="mt-2 text-sm text-graphite-300">Attempt {status.data.attemptsUsed + 1} of {status.data.maxAttempts}</p>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="National ID number" inputMode="numeric" value={nationalId} onChange={(e) => setNationalId(e.target.value.replace(/\D/g, "").slice(0, 8))} error={errors.nationalId} />
        <Field label="KRA PIN" autoCapitalize="characters" value={kraPin} onChange={(e) => setKraPin(e.target.value.toUpperCase().slice(0, 11))} error={errors.kraPin} placeholder="A012345678Z" />
      </div>
      {(Object.keys(LABELS) as Slot[]).map((slot) => (
        <FileField key={slot} label={LABELS[slot]} file={files[slot] ?? null} error={errors[slot]} onPick={(f) => void pick(slot, f)} />
      ))}
      {submit.error instanceof ApiError && <p role="alert" className="text-sm text-danger">{submit.error.message}</p>}
      <Button loading={submit.isPending} onClick={onSubmit}>Submit for review</Button>
    </div>
  );
}
