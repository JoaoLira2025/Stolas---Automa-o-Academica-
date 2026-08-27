import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StolasLogo } from "@/components/stolas-logo";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
});

function AuthLayout() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) navigate({ to: "/login", replace: true });
      else setReady(true);
    });
  }, [navigate]);
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <StolasLogo className="animate-pulse" />
      </div>
    );
  }
  return <Outlet />;
}
