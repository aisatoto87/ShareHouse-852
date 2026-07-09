import Navbar from "@/components/Navbar";
import AdminSubNav from "@/components/admin/AdminSubNav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-50">
      <Navbar />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        <AdminSubNav />
        {children}
      </main>
    </div>
  );
}
