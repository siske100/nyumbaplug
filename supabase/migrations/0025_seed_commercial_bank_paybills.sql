insert into banks (name, paybill) values
  ('KCB', '522522'),
  ('Equity Bank', '247247'),
  ('Co-operative Bank', '400200'),
  ('Absa Kenya', '303030'),
  ('NCBA', '880100'),
  ('Stanbic Bank', '600100'),
  ('I&M Bank', '542542'),
  ('DTB', '516600'),
  ('Family Bank', '222111'),
  ('Standard Chartered', '329329'),
  ('National Bank (KCB Group)', '547700')
on conflict (name) do update
  set paybill = excluded.paybill,
      active = true;
