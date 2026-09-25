import type { Metadata } from "next";
import { AdminDashboard } from "@/components/admin/dashboard";

export const metadata: Metadata = { title: "Producción" };

export default function AdminPage() {
  return <AdminDashboard />;
}
