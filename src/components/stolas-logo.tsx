import stolasIcon from "@/assets/stolas.png";

export function StolasLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img src={stolasIcon} alt="" aria-hidden="true" className="h-8 w-8 object-contain" />
      <span className="text-lg font-semibold tracking-tight">Stolas</span>
    </div>
  );
}
