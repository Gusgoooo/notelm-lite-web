export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#f1f1f1] text-[var(--foreground)]">
      {children}
    </div>
  );
}
