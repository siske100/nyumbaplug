const nf = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });
export const formatKes = (n: number) => `KES ${nf.format(n)}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "");
export const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" }) : "");
export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Today and the next six days: always inside the server's seven-day rule, whatever the time zone. */
export const nextDays = () => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; return { value: v, label: d.toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" }) }; });
