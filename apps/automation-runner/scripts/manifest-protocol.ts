export type TargetPlatform = "web" | "tauri" | "swift"

export type TargetProfile = {
  target_id: string
  platform: TargetPlatform
  driver_id: string
  base_url?: string
  app_path?: string
}

export type RunManifest = {
  run_id: string
  generated_at: string
  target: TargetProfile
  artifacts: {
    session_dir: string
    flow_draft_path: string | null
    har_path: string | null
    html_path: string | null
    video_dir: string | null
    replay_result_path: string | null
  }
  summary: {
    step_total: number
    failed_steps: number
    has_flow_draft: boolean
    has_har: boolean
    has_html: boolean
    has_video: boolean
  }
}
