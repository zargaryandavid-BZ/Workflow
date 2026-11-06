import { redirect } from "next/navigation";

/** Die manufacturers moved to the Manufacturers tab on Die Order. */
export default function DieManufacturersPage() {
  redirect("/die-order?tab=manufacturers");
}
