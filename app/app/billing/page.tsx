import { redirect } from "next/navigation";

export default function LegacyAppBillingPage() {
  redirect("/settings/billing");
}
