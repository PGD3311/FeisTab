-- Enable Supabase Realtime on tables that need live sync across devices
-- competitions was already enabled manually; these complete the set

ALTER PUBLICATION supabase_realtime ADD TABLE score_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE rounds;
ALTER PUBLICATION supabase_realtime ADD TABLE registrations;
