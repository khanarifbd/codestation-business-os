"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

export type DashboardProfile = {
  full_name: string;
  email: string;
  has_avatar: boolean;
  avatar_version: number;
  system_role?: string;
};

export type WorkspaceContext = {
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
    country_code: string;
    timezone: string;
    currency: string;
  };
  membership_id: string;
  role_id: string;
  role: string;
  role_name: string;
  role_slug: string;
  status: string;
  is_owner: boolean;
  relationships: string[];
  primary_relationship: string;
  permissions: string[];
};

export type WorkspaceMembership = {
  organization: WorkspaceContext["organization"];
  membership_id: string;
  role_id: string;
  role: string;
  role_name: string;
  role_slug: string;
  status: string;
  is_owner: boolean;
  relationships: string[];
  primary_relationship: string;
};

type DashboardSessionValue = {
  profile: DashboardProfile | null;
  workspaces: WorkspaceMembership[];
  tenant: WorkspaceContext | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setTenant: (tenant: WorkspaceContext | null) => void;
};

const DashboardSessionContext = createContext<DashboardSessionValue | null>(null);

async function parseJson<T>(response: Response, fallback: T): Promise<T> {
  return await response.json().catch(() => fallback) as T;
}

export function DashboardSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [profile, setProfile] = useState<DashboardProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceMembership[]>([]);
  const [tenant, setTenant] = useState<WorkspaceContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProfile = useCallback(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    if (response.status === 401) {
      router.replace("/login");
      return;
    }
    if (!response.ok) throw new Error("Unable to load your profile.");
    const nextProfile = await parseJson<DashboardProfile | null>(response, null);
    if (!nextProfile) throw new Error("Unable to load your profile.");
    if (nextProfile.system_role === "super_admin") {
      router.replace("/super-admin");
      router.refresh();
      return;
    }
    setProfile(nextProfile);
  }, [router]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profileResponse, organizationsResponse] = await Promise.all([
        fetch("/api/profile", { cache: "no-store" }),
        fetch("/api/organizations", { cache: "no-store" }),
      ]);

      if (profileResponse.status === 401 || organizationsResponse.status === 401) {
        router.replace("/login");
        return;
      }
      if (!profileResponse.ok) throw new Error("Unable to verify your account access.");
      if (!organizationsResponse.ok) throw new Error("Unable to load company workspaces.");

      const nextProfile = await parseJson<DashboardProfile | null>(profileResponse, null);
      const nextWorkspaces = await parseJson<WorkspaceMembership[]>(organizationsResponse, []);
      if (!nextProfile) throw new Error("Unable to verify your account access.");
      if (nextProfile.system_role === "super_admin") {
        router.replace("/super-admin");
        router.refresh();
        return;
      }

      setProfile(nextProfile);
      setWorkspaces(Array.isArray(nextWorkspaces) ? nextWorkspaces : []);

      if (!Array.isArray(nextWorkspaces) || nextWorkspaces.length === 0) {
        setTenant(null);
        router.replace("/onboarding");
        return;
      }

      // /api/organizations validates or initializes the organization cookie.
      // Fetch tenant only after that response has completed so every dashboard
      // consumer can reuse one canonical workspace context.
      const tenantResponse = await fetch("/api/tenant", { cache: "no-store" });
      if (tenantResponse.status === 401) {
        router.replace("/login");
        return;
      }
      if (!tenantResponse.ok) throw new Error("Unable to load company workspace.");
      const nextTenant = await parseJson<WorkspaceContext | null>(tenantResponse, null);
      if (!nextTenant) throw new Error("Unable to load company workspace.");
      setTenant(nextTenant);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard session.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const refresh = () => { void refreshProfile().catch(() => undefined); };
    window.addEventListener("business-os-profile-updated", refresh);
    return () => window.removeEventListener("business-os-profile-updated", refresh);
  }, [refreshProfile]);

  const value = useMemo<DashboardSessionValue>(() => ({
    profile,
    workspaces,
    tenant,
    loading,
    error,
    reload,
    refreshProfile,
    setTenant,
  }), [profile, workspaces, tenant, loading, error, reload, refreshProfile]);

  return <DashboardSessionContext.Provider value={value}>{children}</DashboardSessionContext.Provider>;
}

export function useDashboardSession() {
  const value = useContext(DashboardSessionContext);
  if (!value) throw new Error("useDashboardSession must be used inside DashboardSessionProvider");
  return value;
}
