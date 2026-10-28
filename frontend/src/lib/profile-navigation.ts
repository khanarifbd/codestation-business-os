export const PROFILE_PATH = "/dashboard/profile";
export const PROFILE_ROUTES = {
  overview: PROFILE_PATH, edit: `${PROFILE_PATH}/edit`, photo: `${PROFILE_PATH}/photo`,
  security: `${PROFILE_PATH}/security`, username: `${PROFILE_PATH}/security/username`,
  password: `${PROFILE_PATH}/security/password`, google: `${PROFILE_PATH}/security/google`,
  passkeys: `${PROFILE_PATH}/security/passkeys`, enrollment: `${PROFILE_PATH}/security/passkeys/new`,
  sessions: `${PROFILE_PATH}/security/sessions`,
} as const;
export type ProfileMode = keyof typeof PROFILE_ROUTES;
export function profileMode(pathname: string): ProfileMode | null {
  return (Object.entries(PROFILE_ROUTES).find(([, path]) => path === pathname)?.[0] as ProfileMode | undefined) ?? null;
}
export function profileBack(mode: ProfileMode) {
  return mode === "overview" ? "/dashboard" : mode === "enrollment" ? PROFILE_ROUTES.passkeys : ["overview", "edit", "photo", "security"].includes(mode) ? PROFILE_PATH : PROFILE_ROUTES.security;
}
