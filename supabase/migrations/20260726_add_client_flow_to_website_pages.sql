-- Add client_flow column to website_pages
-- This stores the client journey configuration (Services → Booking → Payment → Intake → Confirmation)

ALTER TABLE website_pages
ADD COLUMN IF NOT EXISTS client_flow JSONB DEFAULT '{"steps": ["booking", "confirmation"], "booking_url": "/booking"}';

-- Add comment explaining the structure
COMMENT ON COLUMN website_pages.client_flow IS 'Client flow configuration: { steps: FlowStep[], booking_url: string, payment_required?: boolean, intake_form_id?: string }';

-- Create website-images storage bucket for block media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'website-images',
  'website-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for website-images bucket
CREATE POLICY "Users can upload website images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'website-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their website images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'website-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their website images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'website-images' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Website images are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'website-images');
