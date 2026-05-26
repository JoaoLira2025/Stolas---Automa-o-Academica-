export function StolasLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative h-8 w-8 rounded-lg flex items-center justify-center" style={{ background: "var(--gradient-primary)" }}>
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 2L4 7v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V7l-8-5z" strokeLinejoin="round"/>
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <span className="text-lg font-semibold tracking-tight">Stolas</span>
    </div>
  );
}
