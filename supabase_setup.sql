-- United Agents Analytics
-- Run this in your Supabase SQL editor

-- Main analytics table
CREATE TABLE IF NOT EXISTS ua_analytics (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  -- 'setup' = someone ran united-agents-mcp setup
  -- 'task_complete' = verify_completeness returned COMPLETE
  -- 'task_incomplete' = verify_completeness returned INCOMPLETE (still working)
  project_hash TEXT, -- anonymized hash of project path, for counting unique projects
  files_in_map INTEGER, -- how many files were in the dependency map
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Public stats view (no sensitive data)
CREATE OR REPLACE VIEW ua_public_stats AS
SELECT
  COUNT(*) FILTER (WHERE event = 'setup') AS total_projects,
  COUNT(*) FILTER (WHERE event = 'task_complete') AS total_tasks_completed,
  COUNT(*) FILTER (WHERE event = 'task_incomplete') AS total_loops_stopped,
  COUNT(DISTINCT project_hash) FILTER (WHERE event = 'setup') AS unique_projects,
  AVG(files_in_map) FILTER (WHERE event = 'task_complete') AS avg_files_per_task
FROM ua_analytics;

-- Enable public read access on the stats view
ALTER VIEW ua_public_stats OWNER TO postgres;

-- Allow anonymous inserts (for the MCP phone-home)
CREATE POLICY "allow_anonymous_inserts" ON ua_analytics
  FOR INSERT TO anon
  WITH CHECK (true);

-- Allow public to read stats view
GRANT SELECT ON ua_public_stats TO anon;
GRANT INSERT ON ua_analytics TO anon;
GRANT USAGE ON SEQUENCE ua_analytics_id_seq TO anon;

-- Enable RLS
ALTER TABLE ua_analytics ENABLE ROW LEVEL SECURITY;
