export type TargetProfile = {
  target_id: string;
  platform: "web" | "tauri" | "swift";
  driver_id: string;
  base_url?: string;
  app_path?: string;
  webdriver_url?: string;
  capabilities?: Record<string, unknown>;
  xcode?: {
    mode?: "test" | "build-for-testing";
    scheme?: string;
    workspace?: string;
    project?: string;
    destination?: string;
    test_plan?: string;
    configuration?: string;
    only_testing?: string[];
    skip_testing?: string[];
  };
};

export type DriverSmokeResult = {
  target_id: string;
  driver_id: string;
  started_at: string;
  finished_at: string;
  ok: boolean;
  detail: string;
  artifacts: {
    report_path: string;
    log_path: string | null;
  };
  metrics: Record<string, unknown>;
};
