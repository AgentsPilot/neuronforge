-- Translate English payment descriptions and payment methods to Hebrew
-- This updates any test/mockup payment descriptions that are in English

-- Update payment descriptions
UPDATE payment_transactions
SET description = CASE
  -- Failed payment variations
  WHEN description ILIKE '%failed payment%' THEN 'תשלום שנכשל'
  WHEN description ILIKE '%payment failed%' THEN 'תשלום שנכשל'
  WHEN description ILIKE '%failed charge%' THEN 'חיוב שנכשל'

  -- Service payment variations
  WHEN description ILIKE '%service payment%' THEN 'תשלום עבור שירות'
  WHEN description ILIKE '%payment for service%' THEN 'תשלום עבור שירות'

  -- Booking payment variations
  WHEN description ILIKE '%booking payment%' THEN 'תשלום עבור הזמנה'
  WHEN description ILIKE '%session payment%' THEN 'תשלום עבור פגישה'

  -- Consultation payment variations
  WHEN description ILIKE '%consultation%' THEN 'תשלום עבור ייעוץ עסקי'
  WHEN description ILIKE '%coaching%' THEN 'תשלום עבור קואצינג'

  -- Workshop payment variations
  WHEN description ILIKE '%workshop%' THEN 'תשלום עבור סדנה'

  -- Refund variations
  WHEN description ILIKE '%refund%' THEN 'תשלום שהוחזר'
  WHEN description ILIKE '%refunded%' THEN 'תשלום שהוחזר'

  -- Pending variations
  WHEN description ILIKE '%pending%' THEN 'ממתין לאישור'
  WHEN description ILIKE '%awaiting%' THEN 'ממתין להעברה'

  -- Generic payment
  WHEN description ILIKE '%payment%' AND description NOT LIKE '%תשלום%' THEN 'תשלום'

  -- Keep original if already in Hebrew or doesn't match any pattern
  ELSE description
END
WHERE
  -- Only update if description is in English (doesn't contain Hebrew characters)
  description !~ '[\u0590-\u05FF]'
  AND description IS NOT NULL;

-- Update payment methods to Hebrew
UPDATE payment_transactions
SET payment_method = CASE
  WHEN payment_method = 'card' THEN 'כרטיס אשראי'
  WHEN payment_method = 'credit_card' THEN 'כרטיס אשראי'
  WHEN payment_method = 'debit_card' THEN 'כרטיס חיוב'
  WHEN payment_method = 'bank_transfer' THEN 'העברה בנקאית'
  WHEN payment_method = 'wire_transfer' THEN 'העברה בנקאית'
  WHEN payment_method = 'bit' THEN 'ביט'
  WHEN payment_method = 'paypal' THEN 'פייפאל'
  WHEN payment_method = 'cash' THEN 'מזומן'
  WHEN payment_method = 'check' THEN 'צ׳ק'
  WHEN payment_method = 'cheque' THEN 'צ׳ק'
  ELSE payment_method
END
WHERE
  payment_method IN ('card', 'credit_card', 'debit_card', 'bank_transfer', 'wire_transfer', 'bit', 'paypal', 'cash', 'check', 'cheque');
