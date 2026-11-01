-- Add the bank-Paybill rent route separately before later migrations use it.
alter type payment_mode add value if not exists 'bank_paybill';
