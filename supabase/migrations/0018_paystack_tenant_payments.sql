-- Commit the new enum value separately before it is used by later migrations.
alter type payment_mode add value if not exists 'paystack';
