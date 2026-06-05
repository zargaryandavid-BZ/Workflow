/** User-friendly message for Supabase Auth email errors. */
export function formatAuthEmailError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return (
      "Supabase email rate limit reached (about 3–4 emails per hour on the default mailer). " +
      "Use the signup link below, wait and try again, or configure custom SMTP in Supabase " +
      "(Authentication → SMTP Settings)."
    );
  }
  return message;
}
