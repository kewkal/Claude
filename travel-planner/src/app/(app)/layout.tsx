import { AppShell } from "@/components/AppShell";
import { env } from "@/lib/env";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell fixtureMode={env.fixtureMode}>{children}</AppShell>;
}
