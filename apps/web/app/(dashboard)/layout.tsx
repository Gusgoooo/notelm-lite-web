export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="h-screen flex flex-col bg-[var(--background)] text-[var(--foreground)]">
      {children}
    </div>
  );
}
