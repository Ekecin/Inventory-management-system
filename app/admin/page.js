import AdminDashboard from "@/components/AdminDashboard";
import "./admin.css";

export const metadata = {
  title: "Admin | Gratitude Technologies",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <AdminDashboard />;
}
