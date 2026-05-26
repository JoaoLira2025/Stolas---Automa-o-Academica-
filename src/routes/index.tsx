import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { StolasLogo } from "@/components/stolas-logo";

export const Route = createFileRoute("/")({ component: Index });

function Index() {
  const navigate = useNavigate();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      navigate({ to: data.session ? "/chat" : "/login", replace: true });
    });
  }, [navigate]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <StolasLogo className="animate-pulse" />
    </div>
  );
}
