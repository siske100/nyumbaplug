// How many SMS segments a message is billed as. Mirrors the server's own counting so the screen's estimate matches the charge.
const GSM_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

export function smsSegments(text: string): number {
  if (text.length === 0) return 0;
  let units = 0, gsm = true;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) return units <= 160 ? 1 : Math.ceil(units / 153);
  const len = [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return len <= 70 ? 1 : Math.ceil(len / 67);
}
export const SMS_PRICE_KES = 0.8;
export const smsCost = (text: string, recipients: number) => Math.round(smsSegments(text) * recipients * SMS_PRICE_KES * 100) / 100;
