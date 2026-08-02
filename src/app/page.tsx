import { redirect } from "next/navigation";

/** Smartlead lands on Email Campaigns — we land on Campaigns. */
export default function HomePage() {
  redirect("/campaigns");
}
