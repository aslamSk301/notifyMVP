-- Indexes for lookups the app runs on every request.
-- Device rows are rewritten on each register, so this file does not add
-- wide segment indexes. Those would make every device write heavier.

CREATE UNIQUE INDEX IF NOT EXISTS projects_api_key_idx
  ON projects (api_key);

CREATE INDEX IF NOT EXISTS notification_campaigns_project_created_idx
  ON notification_campaigns (project_id, created_at);

CREATE INDEX IF NOT EXISTS notification_campaigns_project_status_idx
  ON notification_campaigns (project_id, status);

CREATE INDEX IF NOT EXISTS devices_project_status_idx
  ON devices (project_id, status);

CREATE INDEX IF NOT EXISTS devices_external_user_idx
  ON devices (project_id, external_user_id);

CREATE INDEX IF NOT EXISTS devices_fcm_token_idx
  ON devices (fcm_token);

CREATE INDEX IF NOT EXISTS notification_logs_campaign_idx
  ON notification_logs (campaign_id);

CREATE INDEX IF NOT EXISTS notification_logs_device_idx
  ON notification_logs (device_id);

CREATE INDEX IF NOT EXISTS notification_events_campaign_idx
  ON notification_events (campaign_id);

CREATE INDEX IF NOT EXISTS segment_rules_segment_idx
  ON segment_rules (segment_id);
