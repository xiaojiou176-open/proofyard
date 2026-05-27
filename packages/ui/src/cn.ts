type ClassInput = string | false | null | undefined

export function cn(...inputs: ClassInput[]): string {
  return inputs.filter(Boolean).join(" ")
}
