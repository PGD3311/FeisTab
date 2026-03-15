-- Add structured comment data to score entries
-- New code writes to comment_data (jsonb). Legacy comments column stays for backward compatibility.
alter table score_entries add column comment_data jsonb;
