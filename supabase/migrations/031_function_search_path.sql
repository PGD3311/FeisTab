-- Supabase advisor: function_search_path_mutable. Applied 2026-09-22.
ALTER FUNCTION public.update_updated_at() SET search_path = public;
ALTER FUNCTION public.check_score_not_locked() SET search_path = public;
