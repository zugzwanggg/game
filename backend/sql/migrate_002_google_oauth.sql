-- Run once on existing DBs (nullable password for Google-only accounts + Google subject id).
alter table app_user alter column password_hash drop not null;
alter table app_user add column if not exists google_sub text unique;
