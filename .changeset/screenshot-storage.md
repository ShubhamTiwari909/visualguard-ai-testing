---
"visualguard": minor
---

Store dashboard screenshots outside the database. Set `VISUALGUARD_ARTIFACT_STORAGE_URL` to `s3://…` (including S3-compatible services such as R2 and MinIO), `gs://…` or `azure://…` and install the provider's SDK; new evidence bytes go to that private bucket while the database keeps only the digest index. Without the setting, evidence stays in the database as before. Existing database evidence remains readable, bucket reads are checksum-verified, deleting runs removes unreferenced bucket objects, and portable export/restore read and write through the configured storage.
