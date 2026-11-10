-- 0039_paystack_enum: the new enum value is committed on its own so the next migration can use it.
alter type payment_mode add value if not exists 'paystack';
