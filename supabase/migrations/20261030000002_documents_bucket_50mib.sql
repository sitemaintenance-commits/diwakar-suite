-- PPA - Niwai.pdf is 51.8 MB (49.4 MiB): let the documents bucket hold 50 MiB
-- rather than 50,000,000 bytes.
update storage.buckets set file_size_limit = greatest(file_size_limit, 52428800) where id = 'documents';
