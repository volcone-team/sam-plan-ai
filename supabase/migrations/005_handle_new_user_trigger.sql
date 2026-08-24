-- Create the handle_new_user trigger function.
-- Runs automatically when a new user signs up via Supabase Auth.
-- Creates: company -> profile -> annual_plan for the new user.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_company_id UUID;
  v_company_name TEXT;
  v_first TEXT;
  v_last TEXT;
BEGIN
  -- Extract name from user metadata passed during signUp()
  v_first := COALESCE(NEW.raw_user_meta_data->>'first_name', '');
  v_last  := COALESCE(NEW.raw_user_meta_data->>'last_name', '');
  v_company_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'company_name', ''),
    v_first || E'\x27' || 's Company'
  );

  -- 1. Create a company for this user
  INSERT INTO companies (name, description, fiscal_year, planning_year, currency)
  VALUES (
    v_company_name,
    '',
    EXTRACT(YEAR FROM NOW())::INT,
    EXTRACT(YEAR FROM NOW())::INT,
    'USD'
  )
  RETURNING id INTO new_company_id;

  -- 2. Create the profile linked to the company
  INSERT INTO profiles (id, company_id, email, first_name, last_name, role, is_admin)
  VALUES (
    NEW.id,
    new_company_id,
    NEW.email,
    v_first,
    v_last,
    'owner',
    FALSE
  );

  -- 3. Create a default annual plan
  INSERT INTO annual_plans (company_id, year, baseline_revenue, stretch_revenue, operating_budget, status)
  VALUES (
    new_company_id,
    EXTRACT(YEAR FROM NOW())::INT,
    0, 0, 0,
    'draft'
  );

  RETURN NEW;
END;
$$;

-- Attach the trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
