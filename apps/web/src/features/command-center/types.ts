export type Command = {
  command_id: string
  title: string
  description: string
  tags: string[]
}

export type Task = {
  task_id: string
  command_id: string
  status: "queued" | "running" | "success" | "failed" | "cancelled"
  requested_by: string | null
  attempt: number
  max_attempts: number
  created_at: string
  started_at: string | null
  finished_at: string | null
  exit_code: number | null
  message: string | null
  output_tail: string
  correlation_id?: string | null
  linked_run_id?: string | null
}

export type CommandState = "loading" | "error" | "empty" | "success"
export type TaskState = "loading" | "error" | "empty" | "success"
export type ActionState = "idle" | "success" | "error"
