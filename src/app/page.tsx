import { redirect } from "next/navigation";

// Root route — redirect to dashboard (proxy handles auth check)
export default function Home() {
  redirect("/dashboard");
}
