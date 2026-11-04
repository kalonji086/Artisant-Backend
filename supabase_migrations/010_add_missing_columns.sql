-- Migration 010: Add missing columns to employer_requests table
-- Purpose: Align with migration 002 schema and fix frontend errors

begin;

-- Add missing columns to employer_requests
ALTER TABLE public.employer_requests
  ADD COLUMN IF NOT EXISTS company_email text,
  ADD COLUMN IF NOT EXISTS company_phone text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS company_website text,
  ADD COLUMN IF NOT EXISTS contact_position text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS company_size text,
  ADD COLUMN IF NOT EXISTS years_in_business integer,
  ADD COLUMN IF NOT EXISTS hiring_needs text,
  ADD COLUMN IF NOT EXISTS expected_hires integer,
  ADD COLUMN IF NOT EXISTS job_types text[],
  ADD COLUMN IF NOT EXISTS hear_about_us text,
  ADD COLUMN IF NOT EXISTS additional_notes text,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Add missing price column to quotes
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS price numeric;

commit;

notify pgrst, 'reload schema';
