import { redirect } from "next/navigation";

/** Legacy route — team invites now complete signup on /signup. */
export default function SetPasswordPage() {
  redirect("/signup");
}
